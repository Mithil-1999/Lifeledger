import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultEntry } from "@/features/vault/api";
import { safeHref } from "@/features/vault/constants";
import { DEFAULT_OPTIONS, entropyBits, generatePassword, randomInt } from "@/features/vault/generator";
import { mockApi, renderApp, sentBody } from "./utils";

const SECRET = "S3cr3t-Pa$$word";
const unlockedStatus = () => ({
  status: 200,
  body: { configured: true, unlocked: true, unlocked_until: new Date(Date.now() + 10 * 60_000).toISOString(), unlock_minutes: 10 },
});

function entry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: "e1",
    website: "NIC Asia",
    url: "https://nicasia.com.np",
    category: "banking",
    username: "9800000000",
    email: null,
    is_favorite: false,
    has_notes: true,
    password_changed_at: "2026-09-20T00:00:00Z",
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

const list = (items: VaultEntry[]) => ({
  status: 200,
  body: { items, counts: { all: items.length, favorites: items.filter((i) => i.is_favorite).length, banking: 1 } },
});

let clipboard: { writeText: ReturnType<typeof vi.fn>; readText: ReturnType<typeof vi.fn>; value: string };

/** user-event installs its own clipboard stub in setup(), so install ours afterwards. */
function installClipboard() {
  clipboard = {
    value: "",
    writeText: vi.fn(async (v: string) => {
      clipboard.value = v;
    }),
    readText: vi.fn(async () => clipboard.value),
  };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
}

beforeEach(installClipboard);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// --- Lock state -------------------------------------------------------------------------------------------------

describe("vault lock", () => {
  it("asks for the account password and unlocks", async () => {
    let unlocked = false;
    const fetchMock = mockApi({
      routes: {
        "GET /api/vault/status": () => (unlocked ? unlockedStatus() : { status: 200, body: { configured: true, unlocked: false, unlocked_until: null, unlock_minutes: 10 } }),
        "POST /api/vault/unlock": (init) => {
          if (JSON.parse(String(init.body)).password !== "Correct-Horse-42") return { status: 401, body: { detail: "Incorrect password." } };
          unlocked = true;
          return unlockedStatus();
        },
        "GET /api/vault/entries": list([entry()]),
      },
    });
    const user = userEvent.setup();
    const { router } = renderApp("/vault");
    expect(await screen.findByText("Your vault is locked")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/vault/entries"))).toBe(false); // nothing fetched while locked

    await user.type(screen.getByLabelText("Account password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Unlock vault" }));
    expect(await screen.findByText("Incorrect password.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/vault"); // a wrong vault password doesn't sign you out
    expect(screen.getByLabelText("Account password")).toHaveValue(""); // cleared after each attempt

    await user.type(screen.getByLabelText("Account password"), "Correct-Horse-42");
    await user.click(screen.getByRole("button", { name: "Unlock vault" }));
    expect(await screen.findByRole("list", { name: "Vault entries" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lock now" })).toBeInTheDocument();
  });

  it("explains when the server has no master key", async () => {
    mockApi({ routes: { "GET /api/vault/status": { status: 200, body: { configured: false, unlocked: false, unlocked_until: null, unlock_minutes: 10 } } } });
    renderApp("/vault");
    expect(await screen.findByText("The vault isn't set up on this server")).toBeInTheDocument();
  });

  it("locks on demand", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/vault/status": unlockedStatus(), "GET /api/vault/entries": list([entry()]), "POST /api/vault/lock": { status: 204 } } });
    const user = userEvent.setup();
    renderApp("/vault");
    await user.click(await screen.findByRole("button", { name: "Lock now" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/vault/lock", expect.objectContaining({ method: "POST" })));
  });
});

// --- Secret masking ---------------------------------------------------------------------------------------------------

describe("secret masking", () => {
  const routes = () => ({
    "GET /api/vault/status": unlockedStatus(),
    "GET /api/vault/entries": list([entry()]),
    "POST /api/vault/entries/e1/reveal": { status: 200, body: { password: SECRET } },
  });

  it("keeps the password hidden until explicitly revealed, then hides it again", async () => {
    const fetchMock = mockApi({ routes: routes() });
    const user = userEvent.setup();
    renderApp("/vault");
    const card = within(await screen.findByRole("list", { name: "Vault entries" })).getByRole("listitem");
    expect(within(card).getByLabelText("NIC Asia password (hidden)")).toHaveTextContent("••••");
    expect(document.body).not.toHaveTextContent(SECRET);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/reveal"))).toBe(false); // not decrypted just by listing

    await user.click(within(card).getByRole("button", { name: "Reveal NIC Asia password" }));
    expect(await within(card).findByText(SECRET)).toBeInTheDocument();
    expect(sentBody(fetchMock, "POST", "/api/vault/entries/e1/reveal")).toEqual({ purpose: "reveal" });

    await user.click(within(card).getByRole("button", { name: "Hide NIC Asia password" }));
    expect(within(card).queryByText(SECRET)).not.toBeInTheDocument();
  });

  it("hides a revealed password automatically after the timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi({ routes: routes() });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp("/vault");
    const card = within(await screen.findByRole("list", { name: "Vault entries" })).getByRole("listitem");
    await user.click(within(card).getByRole("button", { name: "Reveal NIC Asia password" }));
    expect(await within(card).findByText(SECRET)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(21_000);
    });
    await waitFor(() => expect(within(card).queryByText(SECRET)).not.toBeInTheDocument());
  });

  it("hides the password when the tab goes to the background", async () => {
    mockApi({ routes: routes() });
    const user = userEvent.setup();
    renderApp("/vault");
    const card = within(await screen.findByRole("list", { name: "Vault entries" })).getByRole("listitem");
    await user.click(within(card).getByRole("button", { name: "Reveal NIC Asia password" }));
    expect(await within(card).findByText(SECRET)).toBeInTheDocument();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(within(card).queryByText(SECRET)).not.toBeInTheDocument();
    visibility.mockRestore();
  });

  it("copies without displaying, and clears the clipboard later if unchanged", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = mockApi({ routes: routes() });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    installClipboard();
    renderApp("/vault");
    const card = within(await screen.findByRole("list", { name: "Vault entries" })).getByRole("listitem");
    await user.click(within(card).getByRole("button", { name: "Copy NIC Asia password" }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(SECRET));
    expect(sentBody(fetchMock, "POST", "/api/vault/entries/e1/reveal")).toEqual({ purpose: "copy" });
    expect(within(card).queryByText(SECRET)).not.toBeInTheDocument(); // copying never shows it
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    await waitFor(() => expect(clipboard.value).toBe(""));
  });

  it("leaves the clipboard alone if you've copied something else since", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi({ routes: routes() });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    installClipboard();
    renderApp("/vault");
    const card = within(await screen.findByRole("list", { name: "Vault entries" })).getByRole("listitem");
    await user.click(within(card).getByRole("button", { name: "Copy NIC Asia password" }));
    await waitFor(() => expect(clipboard.value).toBe(SECRET));
    clipboard.value = "something else";
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    expect(clipboard.value).toBe("something else");
  });
});

// --- CRUD -------------------------------------------------------------------------------------------------------------------

describe("vault entries", () => {
  it("adds an entry, using the generator", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/vault/status": unlockedStatus(), "GET /api/vault/entries": list([]), "POST /api/vault/entries": { status: 201, body: entry() } } });
    const user = userEvent.setup();
    renderApp("/vault");
    await user.click((await screen.findAllByRole("button", { name: "Add entry" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add vault entry" });
    await user.type(within(dialog).getByLabelText("Website / app"), "NIC Asia");
    await user.type(within(dialog).getByLabelText("URL"), "nicasia.com.np");
    await user.type(within(dialog).getByLabelText("Username"), "9800000000");
    await user.selectOptions(within(dialog).getByLabelText("Category"), "banking");

    await user.click(within(dialog).getByRole("button", { name: "Save entry" }));
    expect(await within(dialog).findByText("Enter or generate a password.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /Generate/ }));
    const generated = within(dialog).getByLabelText("Generated password").textContent!;
    expect(generated).toHaveLength(20);
    await user.click(within(dialog).getByRole("button", { name: "Use this password" }));
    expect(within(dialog).getByLabelText("Password")).toHaveValue(generated);
    await user.click(within(dialog).getByRole("button", { name: "Save entry" }));

    await waitFor(() =>
      expect(sentBody(fetchMock, "POST", "/api/vault/entries")).toEqual({
        website: "NIC Asia",
        url: "nicasia.com.np",
        username: "9800000000",
        email: null,
        password: generated,
        category: "banking",
        notes: null,
        is_favorite: false,
      }),
    );
  });

  it("rejects javascript: URLs", async () => {
    mockApi({ routes: { "GET /api/vault/status": unlockedStatus(), "GET /api/vault/entries": list([]) } });
    const user = userEvent.setup();
    renderApp("/vault");
    await user.click((await screen.findAllByRole("button", { name: "Add entry" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add vault entry" });
    await user.type(within(dialog).getByLabelText("Website / app"), "x");
    await user.type(within(dialog).getByLabelText("URL"), "javascript:alert(1)");
    await user.type(within(dialog).getByLabelText("Password"), "pw");
    await user.click(within(dialog).getByRole("button", { name: "Save entry" }));
    expect(await within(dialog).findByText("Use an http(s) address.")).toBeInTheDocument();
  });

  it("edits without prefilling the password, keeping it unless changed", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/vault/status": unlockedStatus(),
        "GET /api/vault/entries": list([entry()]),
        "GET /api/vault/entries/e1": { status: 200, body: { ...entry(), notes: "Security Q: first school" } },
        "PUT /api/vault/entries/e1": { status: 200, body: entry({ website: "NIC Asia Bank" }) },
      },
    });
    const user = userEvent.setup();
    renderApp("/vault");
    await user.click(await screen.findByRole("button", { name: "Actions for NIC Asia" }));
    await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit vault entry" });
    expect(await within(dialog).findByDisplayValue("Security Q: first school")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Password")).toHaveValue(""); // never prefilled
    expect(within(dialog).getByText("Leave blank to keep the current password.")).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("Website / app"));
    await user.type(within(dialog).getByLabelText("Website / app"), "NIC Asia Bank");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sentBody(fetchMock, "PUT", "/api/vault/entries/e1")).toMatchObject({ website: "NIC Asia Bank", password: null }));
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/reveal"))).toBe(false); // editing never decrypts the password
  });

  it("toggles favorites and deletes after confirmation", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/vault/status": unlockedStatus(),
        "GET /api/vault/entries": list([entry()]),
        "PATCH /api/vault/entries/e1/favorite": { status: 200, body: entry({ is_favorite: true }) },
        "DELETE /api/vault/entries/e1": { status: 204 },
      },
    });
    const user = userEvent.setup();
    renderApp("/vault");
    await user.click(await screen.findByRole("button", { name: "Add NIC Asia to favorites" }));
    await waitFor(() => expect(sentBody(fetchMock, "PATCH", "/api/vault/entries/e1/favorite")).toEqual({ is_favorite: true }));
    await user.click(screen.getByRole("button", { name: "Actions for NIC Asia" }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete entry" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/vault/entries/e1", expect.objectContaining({ method: "DELETE" })));
  });

  it("searches and filters", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/vault/status": unlockedStatus(), "GET /api/vault/entries": list([entry()]) } });
    const user = userEvent.setup();
    renderApp("/vault");
    await user.click(await screen.findByRole("tab", { name: /Favorites/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "banking");
    await user.type(screen.getByRole("searchbox", { name: "Search vault" }), "nic");
    await waitFor(() => {
      const last = fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/vault/entries?")).at(-1)!;
      expect(Object.fromEntries(new URL(last, "http://x").searchParams)).toEqual({ search: "nic", category: "banking", favorites: "true" });
    });
  });

  it("shows the audit log", async () => {
    mockApi({
      routes: {
        "GET /api/vault/status": unlockedStatus(),
        "GET /api/vault/entries": list([entry()]),
        "GET /api/vault/audit": {
          status: 200,
          body: [{ id: "a1", action: "secret_revealed", entry_id: "e1", entry_label: "NIC Asia", ip_address: "127.0.0.1", created_at: "2026-09-26T04:00:00Z" }],
        },
      },
    });
    const user = userEvent.setup();
    renderApp("/vault");
    await user.click(await screen.findByRole("button", { name: /Activity/ }));
    const log = await screen.findByRole("list", { name: "Vault activity" });
    expect(within(log).getByText(/Password revealed/)).toHaveTextContent("Password revealed · NIC Asia");
  });
});

// --- Password generator ----------------------------------------------------------------------------------------------------

describe("password generator", () => {
  it("uses the browser CSPRNG, never Math.random", () => {
    const csprng = vi.spyOn(crypto, "getRandomValues");
    const mathRandom = vi.spyOn(Math, "random");
    generatePassword(DEFAULT_OPTIONS);
    expect(csprng).toHaveBeenCalled();
    expect(mathRandom).not.toHaveBeenCalled();
    csprng.mockRestore();
    mathRandom.mockRestore();
  });

  it("respects length and includes every selected character type", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword({ length: 12, uppercase: true, lowercase: true, numbers: true, symbols: true });
      expect(pw).toHaveLength(12);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/\d/);
      expect(pw).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it("only uses the selected character types", () => {
    const pw = generatePassword({ length: 64, uppercase: false, lowercase: false, numbers: true, symbols: false });
    expect(pw).toMatch(/^\d{64}$/);
    const noLookAlikes = generatePassword({ length: 128, uppercase: true, lowercase: true, numbers: true, symbols: false, avoidAmbiguous: true });
    expect(noLookAlikes).not.toMatch(/[O0oIl1]/);
  });

  it("clamps length and requires at least one type", () => {
    expect(generatePassword({ ...DEFAULT_OPTIONS, length: 3 })).toHaveLength(8);
    expect(generatePassword({ ...DEFAULT_OPTIONS, length: 500 })).toHaveLength(128);
    expect(() => generatePassword({ length: 16, uppercase: false, lowercase: false, numbers: false, symbols: false })).toThrow("at least one");
  });

  it("produces different passwords and roughly uniform characters", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword(DEFAULT_OPTIONS)));
    expect(seen.size).toBe(50);
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 20_000; i++) counts[randomInt(10)]++;
    for (const c of counts) expect(c).toBeGreaterThan(1700); // expected 2000 each; biased generators drift badly
  });

  it("validates randomInt input and estimates entropy", () => {
    expect(() => randomInt(0)).toThrow();
    expect(() => randomInt(1.5)).toThrow();
    expect(randomInt(1)).toBe(0);
    expect(entropyBits({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: false })).toBe(119); // 20 × log2(62)
  });
});

describe("safeHref", () => {
  it("only allows http(s)", () => {
    expect(safeHref("https://nicasia.com.np")).toBe("https://nicasia.com.np/");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});
