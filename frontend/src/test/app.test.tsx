import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_NAV_ITEMS } from "@/config/navigation";
import { healthyBody, mockApi, renderApp } from "./utils";

beforeEach(() => document.documentElement.classList.remove("dark"));
afterEach(() => vi.unstubAllGlobals());

describe("routing (signed in)", () => {
  it("redirects / to the dashboard", async () => {
    mockApi();
    const { router } = renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/dashboard");
  });

  it.each(ALL_NAV_ITEMS.filter((i) => i.path !== "/dashboard").map((i) => [i.path, i.title]))(
    "renders the %s placeholder page",
    async (path, title) => {
      mockApi();
      renderApp(path);
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
      expect(screen.getByText(`${title} is coming soon`)).toBeInTheDocument();
    },
  );

  it("shows a not-found page for unknown routes", async () => {
    mockApi();
    renderApp("/does-not-exist");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });

  it("navigates via the sidebar", async () => {
    mockApi();
    const user = userEvent.setup();
    const { router } = renderApp("/dashboard");
    const nav = (await screen.findAllByRole("navigation", { name: "Main navigation" }))[0];
    await user.click(within(nav).getByRole("link", { name: "Password Vault" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Password Vault" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/vault");
  });
});

describe("backend connectivity", () => {
  it("shows API and database as connected when /api/health is ok", async () => {
    const fetchMock = mockApi();
    renderApp("/dashboard");
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("v0.1.0 · test")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.objectContaining({ credentials: "include" }));
  });

  it("shows the database as unavailable on a 503 health response", async () => {
    mockApi({ health: { status: 503, body: { ...healthyBody, status: "degraded", database: "unavailable" } } });
    renderApp("/dashboard");
    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
  });

  it("shows an error state when the API is unreachable", async () => {
    mockApi({ health: "network-error" });
    renderApp("/dashboard");
    // useHealth retries once before surfacing the error, so allow for the retry delay.
    expect(await screen.findByText("Cannot reach the API", {}, { timeout: 4000 })).toBeInTheDocument();
  });
});

describe("theme", () => {
  it("switches to dark mode and persists the choice", async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp("/dashboard");
    await user.click(await screen.findByRole("button", { name: "Change theme" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /dark/i }));
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("lifevault-theme")).toBe("dark");
  });
});
