import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LedgerRecord } from "@/features/finance/api";
import { amountSchema } from "@/features/finance/schemas";
import { emptyPage, emptySummary, expenseCategories, incomeCategories, mockApi, renderApp, sentBody } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const salary = incomeCategories.find((c) => c.name === "Salary")!;
const food = expenseCategories.find((c) => c.name === "Food")!;

function record(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    id: "rec-1",
    amount: "85000.50",
    currency: "NPR",
    date: "2026-09-01",
    category: salary,
    payment_method: "bank_transfer",
    is_recurring: true,
    recurrence_interval: "monthly",
    description: "September salary",
    notes: null,
    source: "Acme Pvt. Ltd.",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const page = (items: LedgerRecord[], total_amount: string) => ({ ...emptyPage, items, total_count: items.length, total_amount });

describe("income page", () => {
  it("shows totals, records and the filtered sum from the API", async () => {
    mockApi({
      routes: {
        "GET /api/incomes": { status: 200, body: page([record()], "85000.50") },
        "GET /api/incomes/summary": {
          status: 200,
          body: { ...emptySummary, year_total: "185000.50", year_count: 3, current_month_total: "85000.50" },
        },
      },
    });
    renderApp("/income");
    expect(await screen.findByRole("heading", { level: 1, name: "Income" })).toBeInTheDocument();
    expect(await screen.findByText("NPR 1,85,000.50")).toBeInTheDocument(); // year total
    expect(screen.getByText("3")).toBeInTheDocument(); // records this year
    const table = screen.getByRole("table", { name: "Income records" });
    expect(within(table).getByText("Acme Pvt. Ltd.")).toBeInTheDocument();
    expect(within(table).getByText("September salary")).toBeInTheDocument();
    expect(screen.getByText(/1 record · Total/)).toHaveTextContent("NPR 85,000.50");
  });

  it("shows an empty state with a call to action when nothing is recorded", async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp("/income");
    expect(await screen.findByText("No income recorded yet")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Add income" }).at(-1)!);
    expect(await screen.findByRole("dialog", { name: "Add income" })).toBeInTheDocument();
  });

  it("validates the form before saving", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    renderApp("/income");
    await user.click((await screen.findAllByRole("button", { name: "Add income" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add income" });

    await user.type(within(dialog).getByLabelText("Amount (NPR)"), "12.345");
    await user.click(within(dialog).getByLabelText(/This income repeats/));
    await user.click(within(dialog).getByRole("button", { name: "Add income" }));

    expect(await within(dialog).findByText("Use a number with at most 2 decimal places.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter where this income came from.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose a category.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose how often this repeats.")).toBeInTheDocument();
    expect(sentBody(fetchMock, "POST", "/api/incomes")).toBeUndefined();
  });

  it("creates income with exact decimal strings", async () => {
    const fetchMock = mockApi({ routes: { "POST /api/incomes": { status: 201, body: record() } } });
    const user = userEvent.setup();
    renderApp("/income");
    await user.click((await screen.findAllByRole("button", { name: "Add income" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add income" });

    await user.type(within(dialog).getByLabelText("Amount (NPR)"), "85,000.5");
    await user.clear(within(dialog).getByLabelText("Date"));
    await user.type(within(dialog).getByLabelText("Date"), "2026-09-01");
    await user.type(within(dialog).getByLabelText("Source"), "Acme Pvt. Ltd.");
    await user.selectOptions(within(dialog).getByLabelText("Category"), salary.id);
    await user.click(within(dialog).getByLabelText(/This income repeats/));
    await user.selectOptions(within(dialog).getByLabelText("Repeats"), "monthly");
    await user.type(within(dialog).getByLabelText("Description"), "September salary");
    await user.click(within(dialog).getByRole("button", { name: "Add income" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sentBody(fetchMock, "POST", "/api/incomes")).toEqual({
      amount: "85000.5", // commas stripped, never converted to a float
      date: "2026-09-01",
      category_id: salary.id,
      payment_method: "bank_transfer",
      is_recurring: true,
      recurrence_interval: "monthly",
      description: "September salary",
      notes: null,
      source: "Acme Pvt. Ltd.",
    });
    expect(await screen.findByText("Income added.")).toBeInTheDocument();
  });

  it("edits a record with the form prefilled", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/incomes": { status: 200, body: page([record()], "85000.50") },
        "PUT /api/incomes/rec-1": { status: 200, body: record({ amount: "90000.00" }) },
      },
    });
    const user = userEvent.setup();
    renderApp("/income");
    // Desktop table and phone cards are both in the DOM (jsdom applies no CSS): use the table.
    const table = await screen.findByRole("table", { name: "Income records" });
    await user.click(within(table).getByRole("button", { name: "Actions for Acme Pvt. Ltd." }));
    await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));

    const dialog = await screen.findByRole("dialog", { name: "Edit income" });
    const amount = within(dialog).getByLabelText("Amount (NPR)");
    expect(amount).toHaveValue("85000.50");
    expect(within(dialog).getByLabelText("Source")).toHaveValue("Acme Pvt. Ltd.");
    await user.clear(amount);
    await user.type(amount, "90000");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(sentBody(fetchMock, "PUT", "/api/incomes/rec-1")).toMatchObject({ amount: "90000", source: "Acme Pvt. Ltd." }));
    expect(await screen.findByText("Income updated.")).toBeInTheDocument();
  });

  it("deletes a record only after confirmation", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/incomes": { status: 200, body: page([record()], "85000.50") },
        "DELETE /api/incomes/rec-1": { status: 204 },
      },
    });
    const user = userEvent.setup();
    renderApp("/income");
    // Desktop table and phone cards are both in the DOM (jsdom applies no CSS): use the table.
    const table = await screen.findByRole("table", { name: "Income records" });
    await user.click(within(table).getByRole("button", { name: "Actions for Acme Pvt. Ltd." }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));

    const confirm = await screen.findByRole("alertdialog", { name: "Delete this income?" });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/incomes/rec-1", expect.objectContaining({ method: "DELETE" })));
    expect(await screen.findByText("Income deleted.")).toBeInTheDocument();
  });
});

describe("expense filters", () => {
  it("sends filters to the API and keeps them in the URL", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/expenses": { status: 200, body: page([], "0.00") } } });
    const user = userEvent.setup();
    const { router } = renderApp("/expenses");
    await screen.findByRole("heading", { level: 1, name: "Expenses" });

    const filters = screen.getByRole("search", { name: "Filter expense" });
    await within(filters).findByRole("option", { name: "Food" }); // categories loaded
    await user.selectOptions(within(filters).getByLabelText("Category"), food.id);
    await user.selectOptions(within(filters).getByLabelText("Payment method"), "mobile_wallet");
    await user.selectOptions(within(filters).getByLabelText("Sort by"), "amount_desc");
    await user.type(within(filters).getByRole("searchbox", { name: "Search" }), "momo");

    await waitFor(() => {
      const last = fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.startsWith("/api/expenses?")).at(-1)!;
      const params = new URL(last, "http://x").searchParams;
      expect(params.get("category_id")).toBe(food.id);
      expect(params.get("payment_method")).toBe("mobile_wallet");
      expect(params.get("sort")).toBe("amount_desc");
      expect(params.get("search")).toBe("momo");
    });
    expect(router.state.location.search).toContain("q=momo");
    expect(await screen.findByText("No matching records")).toBeInTheDocument();
  });

  it("turns a month filter into an inclusive date range", async () => {
    const fetchMock = mockApi();
    renderApp("/expenses?month=2028-02");
    await screen.findByRole("heading", { level: 1, name: "Expenses" });
    await waitFor(() => {
      const url = fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith("/api/expenses?"))!;
      const params = new URL(url, "http://x").searchParams;
      expect(params.get("date_from")).toBe("2028-02-01");
      expect(params.get("date_to")).toBe("2028-02-29"); // leap year
    });
  });
});

describe("custom expense categories", () => {
  it("adds a category and reports conflicts from the API", async () => {
    let calls = 0;
    const fetchMock = mockApi({
      routes: {
        "POST /api/categories": () =>
          ++calls === 1
            ? { status: 201, body: { id: "c-new", kind: "expense", name: "Gym", slug: null, is_system: false } }
            : { status: 409, body: { detail: 'A expense category named "Gym" already exists.' } },
      },
    });
    const user = userEvent.setup();
    renderApp("/expenses");
    await user.click(await screen.findByRole("button", { name: "Categories" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage expense categories" });
    expect(within(dialog).getByText("Pets")).toBeInTheDocument(); // existing custom category

    await user.type(within(dialog).getByLabelText("New category"), "Gym");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(sentBody(fetchMock, "POST", "/api/categories")).toEqual({ kind: "expense", name: "Gym" }));

    await user.type(within(dialog).getByLabelText("New category"), "Gym");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByText(/already exists/)).toBeInTheDocument();
  });

  it("confirms before deleting a custom category", async () => {
    const fetchMock = mockApi({ routes: { "DELETE /api/categories/expense-pets": { status: 204 } } });
    const user = userEvent.setup();
    renderApp("/expenses");
    await user.click(await screen.findByRole("button", { name: "Categories" }));
    await user.click(await screen.findByRole("button", { name: "Delete Pets" }));
    const confirm = await screen.findByRole("alertdialog", { name: 'Delete "Pets"?' });
    await user.click(within(confirm).getByRole("button", { name: "Delete category" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/categories/expense-pets", expect.objectContaining({ method: "DELETE" })));
  });
});

describe("finance overview", () => {
  it("computes net cash flow exactly from decimal strings", async () => {
    mockApi({
      routes: {
        "GET /api/incomes/summary": { status: 200, body: { ...emptySummary, year_total: "100000.30", year_count: 2 } },
        "GET /api/expenses/summary": { status: 200, body: { ...emptySummary, year_total: "0.10", year_count: 1 } },
      },
    });
    renderApp("/finance");
    expect(await screen.findByText("NPR 1,00,000.20")).toBeInTheDocument();
  });

  it("shows a negative net when spending exceeds income", async () => {
    mockApi({
      routes: {
        "GET /api/incomes/summary": { status: 200, body: { ...emptySummary, year_total: "500.00", year_count: 1 } },
        "GET /api/expenses/summary": { status: 200, body: { ...emptySummary, year_total: "750.25", year_count: 1 } },
      },
    });
    renderApp("/finance");
    expect(await screen.findByText("-NPR 250.25")).toBeInTheDocument();
  });
});

describe("amount validation", () => {
  it.each([
    ["1500", "1500"],
    ["1,500.50", "1500.50"],
    ["0.01", "0.01"],
  ])("accepts %s", (input, output) => {
    expect(amountSchema.parse(input)).toBe(output);
  });

  it.each(["", "0", "0.00", "-5", "12.345", "abc", "1e5", "1000000000000"])("rejects %s", (input) => {
    expect(amountSchema.safeParse(input).success).toBe(false);
  });
});
