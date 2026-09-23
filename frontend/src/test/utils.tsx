import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import { AppProviders } from "@/app/providers";
import { routes } from "@/app/routes";
import type { User } from "@/features/auth/api";
import { resetCsrfToken } from "@/lib/api";

export const testUser: User = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Mithil Pandit",
  username: "mithil",
  email: "mithil@example.com",
  status: "active",
  created_at: "2026-09-23T00:00:00Z",
  last_login_at: null,
};

export const healthyBody = {
  status: "ok",
  service: "LifeVault API",
  version: "0.1.0",
  environment: "test",
  database: "ok",
};

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | "network-error";
type Handler = (init: RequestInit & { url: string }) => Reply;

export interface MockApiOptions {
  /** Signed-in user for GET /api/auth/me (null = signed out). */
  user?: User | null;
  health?: Reply;
  /** Per-route overrides, keyed by "METHOD /path". */
  routes?: Record<string, Reply | Handler>;
}

/** Stub `fetch` with a tiny fake of the LifeVault API. Returns the mock for assertions. */
export function mockApi({ user = testUser, health = { status: 200, body: healthyBody }, routes = {} }: MockApiOptions = {}) {
  const table: Record<string, Reply | Handler> = {
    "GET /api/auth/csrf": { status: 200, body: { csrf_token: "csrf-test-token" } },
    "GET /api/auth/config": { status: 200, body: { registration_enabled: true, password_min_length: 12 } },
    "GET /api/auth/me": user ? { status: 200, body: user } : { status: 401, body: { detail: "Not authenticated." } },
    "GET /api/health": health,
    "POST /api/auth/logout": { status: 204 },
    ...routes,
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init.method ?? "GET").toUpperCase();
    const entry = table[`${method} ${url}`];
    if (!entry) return new Response(JSON.stringify({ detail: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
    const reply = typeof entry === "function" ? entry({ ...init, url }) : entry;
    if (reply === "network-error") throw new TypeError("Failed to fetch");
    const hasBody = reply.body !== undefined && reply.status !== 204;
    return new Response(hasBody ? JSON.stringify(reply.body) : null, {
      status: reply.status,
      headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...reply.headers },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function renderApp(path = "/") {
  resetCsrfToken();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { router, queryClient, ...view };
}

/** Find the JSON body sent with a matching request. */
export function sentBody(fetchMock: ReturnType<typeof mockApi>, method: string, url: string): unknown {
  const call = fetchMock.mock.calls.find(([u, i]) => u === url && (i?.method ?? "GET").toUpperCase() === method);
  return call?.[1]?.body ? JSON.parse(String(call[1].body)) : undefined;
}

export function sentHeaders(fetchMock: ReturnType<typeof mockApi>, method: string, url: string): Headers | undefined {
  const call = fetchMock.mock.calls.find(([u, i]) => u === url && (i?.method ?? "GET").toUpperCase() === method);
  return call ? new Headers(call[1]?.headers) : undefined;
}
