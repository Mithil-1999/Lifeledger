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

/** What the API returns today: every module reports "not available yet", with no numbers. */
export const emptyDashboard = {
  currency: "NPR",
  period: { label: "September 2026", start: "2026-09-01", end: "2026-09-30", today: "2026-09-24", timezone: "Asia/Kathmandu" },
  generated_at: "2026-09-24T03:00:00Z",
  finance: {
    available: false,
    available_from_phase: 4,
    monthly_income: null,
    monthly_expenses: null,
    current_balance: null,
    savings: null,
    budget_remaining: null,
  },
  tasks: { available: false, available_from_phase: 6, today: [], pending: [], overdue: [] },
  bills: { available: false, available_from_phase: 5, upcoming: [], overdue: [] },
  reminders: { available: false, available_from_phase: 6, upcoming: [] },
  charts: {
    available: false,
    available_from_phase: 4,
    income_vs_expenses: [],
    expense_categories: [],
    monthly_spending: [],
    savings: [],
  },
};

const category = (kind: "income" | "expense", name: string, is_system = true) => ({
  id: `${kind}-${name.toLowerCase().replace(/\W+/g, "-")}`,
  kind,
  name,
  slug: is_system ? name.toLowerCase() : null,
  is_system,
});

export const incomeCategories = ["Allowance", "Business", "Freelance", "Gift", "Investment", "Salary", "Other"].map((n) =>
  category("income", n),
);
export const expenseCategories = [
  ...["Food", "Groceries", "Rent", "Other"].map((n) => category("expense", n)),
  category("expense", "Pets", false),
];

export const emptyPage = { items: [], total_count: 0, total_amount: "0.00", currency: "NPR", page: 1, page_size: 20 };

export const emptySummary = {
  year: 2026,
  currency: "NPR",
  year_total: "0.00",
  year_count: 0,
  current_month: "2026-09",
  current_month_total: "0.00",
  months: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, total: "0.00", count: 0 })),
  by_category: [],
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
    // Only requested once signed in (the guard blocks it otherwise), e.g. right after register/login.
    "GET /api/dashboard/summary": { status: 200, body: emptyDashboard },
    "POST /api/auth/logout": { status: 204 },
    "GET /api/categories": (init) => ({
      status: 200,
      body: init.url.includes("kind=income") ? incomeCategories : expenseCategories,
    }),
    "GET /api/incomes": { status: 200, body: emptyPage },
    "GET /api/expenses": { status: 200, body: emptyPage },
    "GET /api/incomes/summary": { status: 200, body: emptySummary },
    "GET /api/expenses/summary": { status: 200, body: emptySummary },
    ...routes,
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init.method ?? "GET").toUpperCase();
    // Exact "METHOD /path?query" match first, then the path without its query string.
    const entry = table[`${method} ${url}`] ?? table[`${method} ${url.split("?")[0]}`];
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
