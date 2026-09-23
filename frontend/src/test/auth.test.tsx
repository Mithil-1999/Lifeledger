import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeRedirectPath } from "@/features/auth/redirect";
import { passwordProblems } from "@/features/auth/schemas";
import { UNAUTHORIZED_EVENT } from "@/lib/api";
import { mockApi, renderApp, sentBody, sentHeaders, testUser } from "./utils";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const STRONG = "Correct-Horse-42";

describe("protected routes", () => {
  it("redirects signed-out visitors to login and returns them afterwards", async () => {
    const fetchMock = mockApi({
      user: null,
      routes: { "POST /api/auth/login": { status: 200, body: testUser } },
    });
    const user = userEvent.setup();
    const { router } = renderApp("/expenses");

    expect(await screen.findByRole("heading", { name: "Sign in to LifeVault" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");

    await user.type(screen.getByLabelText("Email or username"), "mithil");
    await user.type(screen.getByLabelText("Password"), STRONG);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Expenses" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/expenses");
    expect(sentBody(fetchMock, "POST", "/api/auth/login")).toEqual({
      identifier: "mithil",
      password: STRONG,
      remember_me: false,
    });
    // State-changing requests carry the CSRF token.
    expect(sentHeaders(fetchMock, "POST", "/api/auth/login")?.get("X-CSRF-Token")).toBe("csrf-test-token");
  });

  it("sends signed-in users away from the login page", async () => {
    mockApi();
    const { router } = renderApp("/login");
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/dashboard");
  });

  it("ends the session when the API reports 401", async () => {
    mockApi();
    const { router } = renderApp("/tasks");
    expect(await screen.findByRole("heading", { level: 1, name: "Tasks" })).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    });
    expect(await screen.findByRole("heading", { name: "Sign in to LifeVault" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });
});

describe("login", () => {
  it("validates required fields before calling the API", async () => {
    const fetchMock = mockApi({ user: null });
    const user = userEvent.setup();
    renderApp("/login");
    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter your email or username.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(sentBody(fetchMock, "POST", "/api/auth/login")).toBeUndefined();
  });

  it("shows the generic error and clears the password on failure", async () => {
    mockApi({
      user: null,
      routes: { "POST /api/auth/login": { status: 401, body: { detail: "Invalid email/username or password." } } },
    });
    const user = userEvent.setup();
    renderApp("/login");
    await user.type(await screen.findByLabelText("Email or username"), "mithil");
    await user.type(screen.getByLabelText("Password"), "Wrong-Password-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email/username or password.");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("shows a friendly message when rate limited", async () => {
    mockApi({
      user: null,
      routes: { "POST /api/auth/login": { status: 429, body: { detail: "Too many attempts. Please wait a moment and try again." } } },
    });
    const user = userEvent.setup();
    renderApp("/login");
    await user.type(await screen.findByLabelText("Email or username"), "mithil");
    await user.type(screen.getByLabelText("Password"), STRONG);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
  });

  it("toggles password visibility", async () => {
    mockApi({ user: null });
    const user = userEvent.setup();
    renderApp("/login");
    const input = await screen.findByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
  });
});

describe("registration", () => {
  async function fillRegister(overrides: Partial<Record<string, string>> = {}) {
    const user = userEvent.setup();
    const values = {
      "Full name": "Mithil Pandit",
      Username: "mithil",
      Email: "mithil@example.com",
      Password: STRONG,
      "Confirm password": STRONG,
      ...overrides,
    };
    for (const [label, value] of Object.entries(values)) {
      if (value) await user.type(await screen.findByLabelText(label), value);
    }
    await user.click(screen.getByRole("button", { name: "Create account" }));
    return user;
  }

  it("validates email, password strength and confirmation", async () => {
    mockApi({ user: null });
    renderApp("/register");
    await fillRegister({ Email: "not-an-email", Password: "weakpass", "Confirm password": "different" });
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 12 characters.")).toBeInTheDocument();
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
  });

  it("maps a duplicate-account conflict onto the right field", async () => {
    mockApi({
      user: null,
      routes: {
        "POST /api/auth/register": {
          status: 409,
          body: { detail: { field: "email", message: "An account with this email already exists." } },
        },
      },
    });
    renderApp("/register");
    await fillRegister();
    expect(await screen.findByText("An account with this email already exists.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("signs the new user in and opens the dashboard", async () => {
    const fetchMock = mockApi({ user: null, routes: { "POST /api/auth/register": { status: 201, body: testUser } } });
    const { router } = renderApp("/register");
    await fillRegister();
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/dashboard");
    expect(sentBody(fetchMock, "POST", "/api/auth/register")).toMatchObject({ username: "mithil", confirm_password: STRONG });
  });

  it("shows a closed message when registration is disabled", async () => {
    mockApi({
      user: null,
      routes: { "GET /api/auth/config": { status: 200, body: { registration_enabled: false, password_min_length: 12 } } },
    });
    renderApp("/register");
    expect(await screen.findByText("Registration is closed")).toBeInTheDocument();
  });
});

describe("logout", () => {
  it("signs out on the server and returns to login", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    const { router } = renderApp("/dashboard");
    await user.click(await screen.findByRole("button", { name: "Open user menu" }));
    await user.click(await screen.findByRole("menuitem", { name: /sign out/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" }));
  });
});

describe("password recovery", () => {
  it("forgot password always shows the same neutral confirmation", async () => {
    const fetchMock = mockApi({
      user: null,
      routes: { "POST /api/auth/forgot-password": { status: 202, body: { message: "ok" } } },
    });
    const user = userEvent.setup();
    renderApp("/forgot-password");
    await user.type(await screen.findByLabelText("Email"), "someone@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText(/If an account exists for that email/)).toBeInTheDocument();
    expect(sentBody(fetchMock, "POST", "/api/auth/forgot-password")).toEqual({ email: "someone@example.com" });
  });

  it("reads the token from the URL fragment, strips it, and resets the password", async () => {
    const fetchMock = mockApi({ user: null, routes: { "POST /api/auth/reset-password": { status: 204 } } });
    window.history.replaceState(null, "", "/reset-password#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
    const user = userEvent.setup();
    const { router } = renderApp("/reset-password");

    await user.type(await screen.findByLabelText("New password"), STRONG);
    expect(window.location.hash).toBe(""); // removed from the address bar/history
    await user.type(screen.getByLabelText("Confirm new password"), STRONG);
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(sentBody(fetchMock, "POST", "/api/auth/reset-password")).toEqual({
      token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      new_password: STRONG,
      confirm_new_password: STRONG,
    });
  });

  it("explains when the reset link is missing", async () => {
    mockApi({ user: null });
    renderApp("/reset-password");
    expect(await screen.findByText("Reset link missing")).toBeInTheDocument();
  });

  it("shows the server's message for an expired link", async () => {
    mockApi({
      user: null,
      routes: {
        "POST /api/auth/reset-password": {
          status: 400,
          body: { detail: "This reset link is invalid or has expired. Please request a new one." },
        },
      },
    });
    window.history.replaceState(null, "", "/reset-password#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
    const user = userEvent.setup();
    renderApp("/reset-password");
    await user.type(await screen.findByLabelText("New password"), STRONG);
    await user.type(screen.getByLabelText("Confirm new password"), STRONG);
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid or has expired");
  });
});

describe("change password", () => {
  it("validates, submits and confirms", async () => {
    const fetchMock = mockApi({
      routes: {
        "POST /api/auth/change-password": {
          status: 200,
          body: { message: "Password changed. Other devices have been signed out." },
        },
      },
    });
    const user = userEvent.setup();
    renderApp("/settings/password");

    await user.type(await screen.findByLabelText("Current password"), STRONG);
    await user.type(screen.getByLabelText("New password"), STRONG);
    await user.type(screen.getByLabelText("Confirm new password"), STRONG);
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("Choose a password different from your current one.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("New password"));
    await user.type(screen.getByLabelText("New password"), "Battery-Staple-77");
    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(screen.getByLabelText("Confirm new password"), "Battery-Staple-77");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password changed. Other devices have been signed out.")).toBeInTheDocument();
    expect(sentBody(fetchMock, "POST", "/api/auth/change-password")).toEqual({
      current_password: STRONG,
      new_password: "Battery-Staple-77",
      confirm_new_password: "Battery-Staple-77",
    });
  });

  it("rejects passwords containing the user's name", async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp("/settings/password");
    await user.type(await screen.findByLabelText("Current password"), STRONG);
    await user.type(screen.getByLabelText("New password"), "Mithil-Secret-99");
    await user.tab();
    expect(await screen.findByText("Don't include your name, username or email.")).toBeInTheDocument();
  });
});

describe("helpers", () => {
  it.each([
    ["/expenses", "/expenses"],
    ["/settings?tab=1", "/settings?tab=1"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["https://evil.example", "/dashboard"],
    [undefined, "/dashboard"],
  ])("safeRedirectPath(%s) = %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it("password policy mirrors the backend", () => {
    expect(passwordProblems(STRONG)).toEqual([]);
    expect(passwordProblems("short")).not.toEqual([]);
    expect(passwordProblems("alllowercaseletters")).toContain("Mix at least three of: lowercase, uppercase, numbers, symbols.");
    expect(passwordProblems("Mithil-Secret-99", ["mithil"])).toContain("Don't include your name, username or email.");
  });
});
