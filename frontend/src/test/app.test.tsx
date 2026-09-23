import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/app/providers";
import { routes } from "@/app/routes";
import { ALL_NAV_ITEMS } from "@/config/navigation";

function renderApp(path = "/", health: { status: number; body: unknown } | "network-error" = { status: 200, body: healthyBody }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (health === "network-error") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(health.body), {
        status: health.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

const healthyBody = {
  status: "ok",
  service: "LifeVault API",
  version: "0.1.0",
  environment: "test",
  database: "ok",
};

beforeEach(() => document.documentElement.classList.remove("dark"));
afterEach(() => vi.unstubAllGlobals());

describe("routing", () => {
  it("redirects / to the dashboard", async () => {
    const router = renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/dashboard");
  });

  it.each(ALL_NAV_ITEMS.filter((i) => i.path !== "/dashboard").map((i) => [i.path, i.title]))(
    "renders the %s placeholder page",
    async (path, title) => {
      renderApp(path);
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
      expect(screen.getByText(`${title} is coming soon`)).toBeInTheDocument();
    },
  );

  it("shows a not-found page for unknown routes", async () => {
    renderApp("/does-not-exist");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });

  it("navigates via the sidebar", async () => {
    const user = userEvent.setup();
    const router = renderApp("/dashboard");
    const nav = screen.getAllByRole("navigation", { name: "Main navigation" })[0];
    await user.click(within(nav).getByRole("link", { name: "Password Vault" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Password Vault" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/vault");
  });
});

describe("backend connectivity", () => {
  it("shows API and database as connected when /api/health is ok", async () => {
    renderApp("/dashboard");
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("v0.1.0 · test")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/health", expect.objectContaining({ credentials: "include" }));
  });

  it("shows the database as unavailable on a 503 health response", async () => {
    renderApp("/dashboard", { status: 503, body: { ...healthyBody, status: "degraded", database: "unavailable" } });
    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
  });

  it("shows an error state when the API is unreachable", async () => {
    renderApp("/dashboard", "network-error");
    // useHealth retries once before surfacing the error, so allow for the retry delay.
    expect(await screen.findByText("Cannot reach the API", {}, { timeout: 4000 })).toBeInTheDocument();
  });
});

describe("theme", () => {
  it("switches to dark mode and persists the choice", async () => {
    const user = userEvent.setup();
    renderApp("/dashboard");
    await user.click(screen.getByRole("button", { name: "Change theme" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /dark/i }));
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("lifevault-theme")).toBe("dark");
  });
});
