import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDate, setDateFormatPreference } from "@/lib/format";
import { describeDevice } from "@/features/account/helpers";
import { _setDeferredPromptForTests } from "@/lib/pwa";
import { mockApi, renderApp, sentBody, testUser } from "./utils";

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setDateFormatPreference("default");
});

const calls = (fetchMock: ReturnType<typeof mockApi>, method: string, url: string) =>
  fetchMock.mock.calls.filter(([u, i]) => String(u) === url && (i?.method ?? "GET").toUpperCase() === method);

const sessions = [
  { id: "s1", created_at: "2026-09-20T03:00:00Z", last_seen_at: "2026-09-24T03:00:00Z", expires_at: "2026-10-20T03:00:00Z", user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36", ip_address: "127.0.0.1", current: true },
  { id: "s2", created_at: "2026-09-21T03:00:00Z", last_seen_at: "2026-09-23T03:00:00Z", expires_at: "2026-10-21T03:00:00Z", user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1", ip_address: "192.168.1.5", current: false },
];

describe("account helpers", () => {
  it("applies the date format preference to full dates only", () => {
    expect(formatDate("2026-09-24")).toBe("Thu, 24 Sept 2026".replace("Sept", new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 8, 1)))));
    setDateFormatPreference("iso");
    expect(formatDate("2026-09-24")).toBe("2026-09-24");
    setDateFormatPreference("dmy");
    expect(formatDate("2026-09-04")).toBe("04/09/2026");
    setDateFormatPreference("mdy");
    expect(formatDate("2026-09-04")).toBe("09/04/2026");
    expect(formatDate("2026-09-04", { day: "numeric", month: "short" })).toMatch(/^4 Sept?$/); // short forms keep their style
  });

  it("describes devices", () => {
    expect(describeDevice(sessions[0].user_agent)).toBe("Chrome on Windows");
    expect(describeDevice(sessions[1].user_agent)).toBe("Safari on iOS");
    expect(describeDevice(null)).toBe("Unknown device");
  });
});

describe("settings: profile", () => {
  it("saves the name without asking for the password", async () => {
    const fetchMock = mockApi({ routes: { "PUT /api/account/profile": { status: 200, body: { ...testUser, name: "Mithil P." } } } });
    const user = userEvent.setup();
    renderApp("/settings");
    const name = await screen.findByLabelText("Name");
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    await user.clear(name);
    await user.type(name, "Mithil P.");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(sentBody(fetchMock, "PUT", "/api/account/profile")).toEqual({ name: "Mithil P.", username: "mithil", email: "mithil@example.com" }));
    expect(await screen.findByText("Profile saved.")).toBeInTheDocument();
  });

  it("asks for the current password to change the email", async () => {
    const fetchMock = mockApi({
      routes: { "PUT /api/account/profile": { status: 409, body: { detail: "That email is already in use." } } },
    });
    const user = userEvent.setup();
    renderApp("/settings?tab=profile");
    const email = await screen.findByLabelText("Email");
    await user.clear(email);
    await user.type(email, "taken@example.com");
    const password = await screen.findByLabelText("Current password");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("Enter your current password to change your username or email.")).toBeInTheDocument();
    await user.type(password, "Correct-Horse-42");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("That email is already in use.")).toBeInTheDocument();
    expect(sentBody(fetchMock, "PUT", "/api/account/profile")).toMatchObject({ email: "taken@example.com", current_password: "Correct-Horse-42" });
  });

  it("uploads a profile picture and shows it in the user menu", async () => {
    const fetchMock = mockApi({
      routes: { "POST /api/account/avatar": { status: 200, body: { ...testUser, has_avatar: true, avatar_updated_at: "2026-09-24T05:00:00Z" } } },
    });
    const user = userEvent.setup();
    const { container } = renderApp("/settings");
    await screen.findByRole("button", { name: /Upload picture/ });
    const file = new File([new Uint8Array([137, 80, 78, 71])], "me.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Profile picture file"), file);
    await waitFor(() => expect(calls(fetchMock, "POST", "/api/account/avatar")).toHaveLength(1));
    expect(calls(fetchMock, "POST", "/api/account/avatar")[0][1]?.body).toBeInstanceOf(FormData);
    await waitFor(() => expect(container.querySelectorAll('img[src^="/api/account/avatar?v="]').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });
});

describe("settings: security", () => {
  it("lists sessions and signs out other devices", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/account/sessions": { status: 200, body: sessions },
        "GET /api/account/security-activity": {
          status: 200,
          body: [
            { id: "a1", event: "login_failed", ip_address: "10.0.0.9", user_agent: null, detail: null, created_at: "2026-09-24T02:00:00Z" },
            { id: "a2", event: "data_exported", ip_address: "127.0.0.1", user_agent: sessions[0].user_agent, detail: "json, all", created_at: "2026-09-23T02:00:00Z" },
          ],
        },
        "GET /api/account/two-factor": { status: 200, body: { available: false, enabled: false, methods_planned: ["totp", "recovery_codes"] } },
        "DELETE /api/account/sessions/s2": { status: 204 },
        "POST /api/account/sessions/revoke-others": { status: 200, body: { count: 1 } },
      },
    });
    const user = userEvent.setup();
    renderApp("/settings?tab=security");
    const list = await screen.findByRole("list", { name: "Active sessions" });
    const [current, phone] = within(list).getAllByRole("listitem");
    expect(within(current).getByText("This device")).toBeInTheDocument();
    expect(within(current).queryByRole("button")).not.toBeInTheDocument();
    expect(phone).toHaveTextContent("Safari on iOS");
    await user.click(within(phone).getByRole("button", { name: "Sign out Safari on iOS" }));
    await waitFor(() => expect(calls(fetchMock, "DELETE", "/api/account/sessions/s2")).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: /Sign out other sessions/ }));
    const confirm = await screen.findByRole("alertdialog", { name: "Sign out all other sessions?" });
    await user.click(within(confirm).getByRole("button", { name: "Sign out others" }));
    expect(await screen.findByText("Signed out 1 session.")).toBeInTheDocument();

    const activity = await screen.findByRole("list", { name: "Security activity" });
    expect(activity).toHaveTextContent("Failed sign-in attempt");
    expect(activity).toHaveTextContent("Data exported · json, all");
    expect(screen.getByText(/Not available yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Change password/ })).toHaveAttribute("href", "/settings/password");
  });
});

describe("settings: preferences", () => {
  it("saves the date format and shows server-wide settings", async () => {
    const fetchMock = mockApi({
      routes: { "PUT /api/account/preferences": (init) => ({ status: 200, body: { ...JSON.parse(String(init.body)), timezone: "Asia/Kathmandu", supported_currencies: ["NPR"] } }) },
    });
    const user = userEvent.setup();
    renderApp("/settings?tab=preferences");
    expect(await screen.findByLabelText("Currency")).toBeDisabled(); // NPR is the only supported currency
    expect(screen.getByLabelText("Timezone")).toHaveValue("Asia/Kathmandu");
    await user.selectOptions(screen.getByLabelText("Date format"), "iso");
    await waitFor(() => expect(sentBody(fetchMock, "PUT", "/api/account/preferences")).toEqual({ currency: "NPR", date_format: "iso" }));
    await user.selectOptions(screen.getByLabelText("Theme"), "dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByRole("link", { name: /Notifications/ })).toHaveAttribute("href", "/notifications");
  });
});

describe("settings: data", () => {
  const backup = {
    counts: { incomes: 3, expenses: 12, budgets: 1, bills: 2, savings_goals: 1, tasks: 4, reminders: 2, calendar_events: 0, notes: 5, documents: 2, vault_entries: 7 },
    document_bytes: 2_621_440,
    last_export_at: null,
    app_version: "0.1.0",
    database_revision: "0010",
  };

  it("exports data after confirming the password", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/account/backup-info": { status: 200, body: backup },
        "POST /api/account/export": { status: 200, body: { format: "lifevault-export" }, headers: { "content-disposition": 'attachment; filename="lifevault-financial-export.json"' } },
      },
    });
    const user = userEvent.setup();
    renderApp("/settings?tab=data");
    expect(await screen.findByText("Income records")).toBeInTheDocument();
    expect(screen.getByText("2.5 MB")).toBeInTheDocument();
    expect(screen.getByText("never")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Financial data/ }));
    const dialog = await screen.findByRole("dialog", { name: "Export financial data" });
    expect(within(dialog).getByRole("button", { name: /Download JSON/ })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Confirm your password"), "Correct-Horse-42");
    await user.click(within(dialog).getByRole("button", { name: /Download JSON/ }));
    expect(await screen.findByText("Downloaded lifevault-financial-export.json.")).toBeInTheDocument();
    expect(sentBody(fetchMock, "POST", "/api/account/export")).toEqual({ scope: "financial", password: "Correct-Horse-42" });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("shows a wrong-password error on export", async () => {
    mockApi({ routes: { "GET /api/account/backup-info": { status: 200, body: backup }, "POST /api/account/export": { status: 403, body: { detail: "Your password is incorrect." } } } });
    const user = userEvent.setup();
    renderApp("/settings?tab=data");
    await user.click(await screen.findByRole("button", { name: /Everything/ }));
    const dialog = await screen.findByRole("dialog", { name: "Export all your data" });
    await user.type(within(dialog).getByLabelText("Confirm your password"), "nope");
    await user.click(within(dialog).getByRole("button", { name: /Download JSON/ }));
    expect(await within(dialog).findByText("Your password is incorrect.")).toBeInTheDocument();
  });

  it("deletes the account only after typing DELETE and the password", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/account/backup-info": { status: 200, body: backup }, "DELETE /api/account": { status: 204 } } });
    const user = userEvent.setup();
    const { router } = renderApp("/settings?tab=data");
    await user.click(await screen.findByRole("button", { name: /Delete account/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete your account permanently?" });
    const submit = within(dialog).getByRole("button", { name: "Delete my account" });
    await user.type(within(dialog).getByLabelText("Type DELETE to confirm"), "delete");
    await user.type(within(dialog).getByLabelText("Your password"), "Correct-Horse-42");
    expect(submit).toBeDisabled(); // must be exactly DELETE
    await user.clear(within(dialog).getByLabelText("Type DELETE to confirm"));
    await user.type(within(dialog).getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(submit);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(sentBody(fetchMock, "DELETE", "/api/account")).toEqual({ password: "Correct-Horse-42", confirmation: "DELETE" });
  }, 30_000);
});

describe("settings: install the app", () => {
  afterEach(() => _setDeferredPromptForTests(null));

  it("offers the browser's install dialog when available", async () => {
    const prompt = vi.fn(async () => undefined);
    _setDeferredPromptForTests(Object.assign(new Event("beforeinstallprompt"), { prompt, userChoice: Promise.resolve({ outcome: "accepted" as const }) }));
    mockApi();
    const user = userEvent.setup();
    renderApp("/settings?tab=preferences");
    await user.click(await screen.findByRole("button", { name: /Install LifeVault/ }));
    expect(prompt).toHaveBeenCalled();
    expect(await screen.findByText("LifeVault is installed on this device.")).toBeInTheDocument();
  });

  it("explains Add to Home Screen on iPhone", async () => {
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1");
    mockApi();
    renderApp("/settings?tab=preferences");
    expect(await screen.findByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Install LifeVault/ })).not.toBeInTheDocument();
    ua.mockRestore();
  });

  it("shows the browser menu steps elsewhere and never caches data", async () => {
    mockApi();
    renderApp("/settings?tab=preferences");
    expect(await screen.findByText(/Install app/)).toBeInTheDocument();
    expect(screen.getByText(/Your data is never stored for offline use/)).toBeInTheDocument();
  });
});
