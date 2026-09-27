import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BillsReport, BudgetReport, ExpenseReport, FinanceReport, ReportPeriod, SavingsReport } from "@/features/reports/api";
import { mockApi, renderApp } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const period = (overrides: Partial<ReportPeriod> = {}): ReportPeriod => ({
  kind: "year",
  start: "2025-01-01",
  end: "2025-12-31",
  label: "2025",
  trend_start: "2025-01-01",
  months: ["2025-01", "2025-02"],
  trend_months: ["2025-01", "2025-02"],
  ...overrides,
});

const finance = (overrides: Partial<FinanceReport["totals"]> = {}): FinanceReport => ({
  currency: "NPR",
  period: period(),
  totals: {
    income: "101000.50",
    expenses: "80000.25",
    net: "21000.25",
    savings_rate: "20.8",
    savings_deposits: "5000.00",
    savings_withdrawals: "1000.00",
    savings: "4000.00",
    closing_balance: "21000.25",
    balance_as_of: "2025-12-31",
    ...overrides,
  },
  months: [
    { month: "2025-01", income: "50000.00", expenses: "20000.25", net: "29999.75", savings: "0.00", balance: "29999.75" },
    { month: "2025-02", income: "51000.50", expenses: "60000.00", net: "-8999.50", savings: "4000.00", balance: null },
  ],
});

const expenses: ExpenseReport = {
  currency: "NPR",
  period: period({ kind: "month", label: "February 2025", start: "2025-02-01", end: "2025-02-28", months: ["2025-02"] }),
  category_id: null,
  total: "12350.50",
  count: 4,
  previous: { start: "2025-01-01", end: "2025-01-31", total: "12580.00", change: { amount: "-229.50", percent: "-1.8" } },
  by_category: [
    { category_id: "c-rent", category: "Rent", amount: "12000.00", count: 1, percent: "97.2", previous_amount: "12000.00", change: { amount: "0.00", percent: "0.0" } },
    { category_id: "c-bus", category: "Transport", amount: "50.50", count: 1, percent: "0.4", previous_amount: "0.00", change: { amount: "50.50", percent: null } },
  ],
  largest: [{ id: "x1", date: "2025-02-01", category: "Rent", description: "Room rent", amount: "12000.00", payment_method: "cash", is_recurring: true, recurrence_interval: "monthly" }],
  recurring: {
    total: "12000.00",
    count: 1,
    percent_of_total: "97.2",
    items: [{ category: "Rent", description: "Room rent", interval: "monthly", count: 1, total: "12000.00", last_amount: "12000.00", last_date: "2025-02-01" }],
  },
  monthly: [
    { month: "2025-01", amount: "12580.00", change: null },
    { month: "2025-02", amount: "12350.50", change: { amount: "-229.50", percent: "-1.8" } },
  ],
};

const budget: BudgetReport = {
  currency: "NPR",
  period: period({ kind: "month", label: "February 2025", months: ["2025-02"] }),
  category_id: null,
  whole_months: true,
  totals: { budget: "1000.00", spent: "1250.00", remaining: "-250.00", percent_used: "125.0", unbudgeted_spent: "50.50" },
  months: [{ month: "2025-02", budget: "1000.00", spent: "1250.00", remaining: "-250.00", percent_used: "125.0", budgeted_categories: 1, over_budget: 1, unbudgeted_spent: "50.50" }],
  categories: [{ category_id: "c-food", category: "Food", budget: "1000.00", spent: "1250.00", remaining: "-250.00", percent_used: "125.0", months_budgeted: 1, months_over: 1 }],
};

const savings: SavingsReport = {
  currency: "NPR",
  period: period(),
  totals: { deposits: "7500.00", withdrawals: "1000.00", net: "6500.00", total_saved: "6500.00", total_target: "12000.00", progress_percent: "54.2", goals: 2, completed_goals: 1 },
  months: [
    { month: "2025-01", deposits: "0.00", withdrawals: "0.00", net: "0.00", total_saved: "0.00" },
    { month: "2025-02", deposits: "5000.00", withdrawals: "1000.00", net: "4000.00", total_saved: "4000.00" },
  ],
  goals: [
    {
      id: "g1", name: "Laptop", target_amount: "2000.00", current_amount: "2500.00", currency: "NPR", target_date: null, description: null,
      progress_percent: "125.0", remaining_amount: "0.00", completed: true, monthly_needed: null, created_at: "", updated_at: "", saved_in_period: "2500.00",
    },
  ],
};

const bills: BillsReport = {
  currency: "NPR",
  period: period(),
  category: null,
  today: "2026-09-24",
  paid: { total: "1500.25", count: 1, by_bill: [{ bill_id: "b1", name: "Electricity", category: "electricity", count: 1, total: "1500.25" }], by_category: [{ category: "electricity", total: "1500.25" }] },
  pending: { total: "700.00", count: 1, items: [{ id: "b2", name: "Milk", category: "other", amount: "700.00", due_date: "2026-09-26", frequency: "weekly", days_until_due: 2 }] },
  overdue: { total: "12000.00", count: 1, items: [{ id: "b3", name: "Room rent", category: "rent", amount: "12000.00", due_date: "2026-09-14", frequency: "monthly", days_until_due: -10 }] },
  recurring: {
    count: 3,
    by_frequency: [
      { frequency: "weekly", count: 1, per_cycle: "700.00", per_year: "36400.00" },
      { frequency: "monthly", count: 2, per_cycle: "13500.25", per_year: "162003.00" },
    ],
    yearly_total: "198403.00",
    monthly_average: "16533.58",
  },
  monthly_paid: [
    { month: "2025-01", amount: "0.00" },
    { month: "2025-02", amount: "1500.25" },
  ],
};

const reportCalls = (fetchMock: ReturnType<typeof mockApi>, kind: string) =>
  fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith(`/api/reports/${kind}?`));

const lastParams = (fetchMock: ReturnType<typeof mockApi>, kind: string) => new URL(reportCalls(fetchMock, kind).at(-1)!, "http://x").searchParams;

const routes = {
  "GET /api/reports/finance": { status: 200, body: finance() },
  "GET /api/reports/expenses": { status: 200, body: expenses },
  "GET /api/reports/budget": { status: 200, body: budget },
  "GET /api/reports/savings": { status: 200, body: savings },
  "GET /api/reports/bills": { status: 200, body: bills },
};

const figure = (label: string) => screen.getByRole("group", { name: label });

describe("reports page", () => {
  it("shows the monthly finance report with exact figures", async () => {
    mockApi({ routes });
    renderApp("/reports?period=year&year=2025");
    expect(await screen.findByRole("heading", { name: /Monthly finance · 2025/ })).toBeInTheDocument();
    expect(figure("Income")).toHaveTextContent(/NPR\s*1,01,000\.50/);
    expect(figure("Net (income − expenses)")).toHaveTextContent("You kept 20.8% of your income.");
    expect(figure("Balance")).toHaveTextContent(/21,000\.25/);
    expect(screen.getByText(/Added to savings goals in this period/)).toHaveTextContent(/4,000\.00.*deposits NPR\s*5,000\.00, withdrawals NPR\s*1,000\.00/);
    const table = screen.getByRole("table", { name: "Monthly finance" });
    const feb = within(table).getByRole("row", { name: /Feb 2025/ });
    expect(feb).toHaveTextContent(/-NPR\s*8,999\.50/);
    expect(within(feb).getAllByRole("cell").at(-1)).toHaveTextContent("—"); // no balance for a month that hasn't started
  });

  it("never invents a savings rate or balance", async () => {
    mockApi({ routes: { ...routes, "GET /api/reports/finance": { status: 200, body: finance({ income: "0.00", savings_rate: null, closing_balance: null, balance_as_of: null }) } } });
    renderApp("/reports?period=year&year=2030");
    expect(await screen.findByText("No income in this period, so there's no savings rate.")).toBeInTheDocument();
    expect(figure("Balance")).toHaveTextContent("—");
    expect(screen.getByText("This period hasn't started yet.")).toBeInTheDocument();
  });

  it("sends month, year and custom date filters", async () => {
    const fetchMock = mockApi({ routes });
    const user = userEvent.setup();
    renderApp("/reports?period=month&month=2025-02");
    await screen.findByRole("heading", { name: /Monthly finance/ });
    expect(lastParams(fetchMock, "finance").get("month")).toBe("2025-02");

    await user.selectOptions(screen.getByLabelText("Month"), "11");
    await waitFor(() => expect(lastParams(fetchMock, "finance").get("month")).toBe("2025-11"));
    await user.selectOptions(screen.getByLabelText("Year"), "2024");
    await waitFor(() => expect(lastParams(fetchMock, "finance").get("month")).toBe("2024-11"));

    await user.selectOptions(screen.getByLabelText("Period"), "year");
    await waitFor(() => expect(lastParams(fetchMock, "finance").has("year")).toBe(true));
    expect(lastParams(fetchMock, "finance").has("month")).toBe(false);

    await user.selectOptions(screen.getByLabelText("Period"), "range");
    expect(await screen.findByText("Choose a start and an end date.")).toBeInTheDocument();
    const before = reportCalls(fetchMock, "finance").length;
    await user.type(screen.getByLabelText("From"), "2025-03-10");
    await user.type(screen.getByLabelText("To"), "2025-03-01");
    expect(await screen.findByText("The end date can't be before the start date.")).toBeInTheDocument();
    expect(reportCalls(fetchMock, "finance").length).toBe(before); // nothing sent for an invalid range
    expect(screen.getByRole("button", { name: /Export CSV/ })).toBeDisabled();

    await user.clear(screen.getByLabelText("To"));
    await user.type(screen.getByLabelText("To"), "2025-04-20");
    await waitFor(() => expect(lastParams(fetchMock, "finance").get("date_to")).toBe("2025-04-20"));
    expect(lastParams(fetchMock, "finance").get("date_from")).toBe("2025-03-10");
  }, 30_000); // lots of typing: slow when the whole suite runs in parallel

  it("shows the expense report and filters by category", async () => {
    const fetchMock = mockApi({ routes });
    const user = userEvent.setup();
    renderApp("/reports?report=expenses&period=month&month=2025-02");
    expect(await screen.findByRole("heading", { name: /Expenses · February 2025/ })).toBeInTheDocument();
    expect(figure("Total spent")).toHaveTextContent(/12,350\.50/);
    expect(figure("Total spent")).toHaveTextContent("4 expenses");
    expect(figure("Vs previous period")).toHaveTextContent(/-NPR\s*229\.50 \(-1\.8%\)|NPR\s*-229\.50 \(-1\.8%\)/);
    expect(figure("Recurring expenses")).toHaveTextContent("97.2% of spending");

    const breakdown = screen.getByRole("table", { name: "Expenses by category" });
    const transport = within(breakdown).getByRole("row", { name: /Transport/ });
    expect(transport).toHaveTextContent("0.4%");
    expect(transport).toHaveTextContent(/\+NPR\s*50\.50$/); // no percentage for a change from nothing
    expect(within(breakdown).getByRole("row", { name: /Rent/ })).toHaveTextContent("No change");
    expect(screen.getByRole("table", { name: "Largest expenses" })).toHaveTextContent("Room rent");
    expect(screen.getByRole("table", { name: "Recurring expenses" })).toHaveTextContent("Monthly");

    await screen.findByRole("option", { name: "Food" });
    const food = (screen.getByRole("option", { name: "Food" }) as HTMLOptionElement).value;
    await user.selectOptions(screen.getByLabelText("Category"), "Food");
    await waitFor(() => expect(lastParams(fetchMock, "expenses").get("category_id")).toBe(food));
  });

  it("shows budget vs actual, including overspending", async () => {
    mockApi({ routes });
    renderApp("/reports?report=budget&period=month&month=2025-02");
    expect(await screen.findByRole("heading", { name: /Budget · February 2025/ })).toBeInTheDocument();
    expect(figure("Over budget by")).toHaveTextContent(/NPR\s*250\.00/);
    expect(figure("Used")).toHaveTextContent("125.0%");
    expect(figure("Used")).toHaveTextContent(/Plus NPR\s*50\.50 in categories without a budget/);
    expect(screen.getByRole("table", { name: "Budget by category" })).toHaveTextContent("Food");
  });

  it("invites you to set a budget when there are none", async () => {
    mockApi({ routes: { ...routes, "GET /api/reports/budget": { status: 200, body: { ...budget, categories: [], months: [] } } } });
    renderApp("/reports?report=budget");
    expect(await screen.findByText("No budgets in this period")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set a budget" })).toHaveAttribute("href", "/budget");
  });

  it("shows savings and goal progress", async () => {
    mockApi({ routes });
    renderApp("/reports?report=savings&period=year&year=2025");
    expect(await screen.findByRole("heading", { name: /Savings · 2025/ })).toBeInTheDocument();
    expect(figure("Saved in this period")).toHaveTextContent(/6,500\.00/);
    expect(figure("Overall progress")).toHaveTextContent("54.2%");
    expect(figure("Goals reached")).toHaveTextContent("1 of 2");
    expect(within(screen.getByRole("table", { name: "Savings goals" })).getByRole("row", { name: /Laptop/ })).toHaveTextContent("Reached");
  });

  it("shows paid, pending, overdue and recurring bills", async () => {
    const fetchMock = mockApi({ routes });
    const user = userEvent.setup();
    renderApp("/reports?report=bills&period=year&year=2025");
    expect(await screen.findByRole("heading", { name: /Bills · 2025/ })).toBeInTheDocument();
    expect(figure("Paid")).toHaveTextContent(/1,500\.25/);
    expect(figure("Pending")).toHaveTextContent(/700\.00/);
    expect(figure("Overdue")).toHaveTextContent(/12,000\.00/);
    expect(figure("Recurring bills")).toHaveTextContent(/16,533\.58/);
    expect(screen.getByRole("table", { name: "Overdue bills" })).toHaveTextContent("10 days ago");
    expect(within(screen.getByRole("table", { name: "Recurring bills by frequency" })).getByRole("row", { name: /Weekly/ })).toHaveTextContent(/36,400\.00/);

    await user.selectOptions(screen.getByLabelText("Category"), "rent");
    await waitFor(() => expect(lastParams(fetchMock, "bills").get("category")).toBe("rent"));
  });

  it("links the CSV export to the current report and filters", async () => {
    mockApi({ routes });
    const user = userEvent.setup();
    renderApp("/reports?report=expenses&period=year&year=2025");
    await screen.findByRole("heading", { name: /Expenses/ });
    expect(screen.getByRole("link", { name: "Export Expenses report as CSV" })).toHaveAttribute("href", "/api/reports/expenses/export.csv?year=2025");
    await user.click(screen.getByRole("tab", { name: "Bills" }));
    expect(await screen.findByRole("link", { name: "Export Bills report as CSV" })).toHaveAttribute("href", "/api/reports/bills/export.csv?year=2025");
  });

  it("shows an error with retry", async () => {
    let fail = true;
    mockApi({ routes: { ...routes, "GET /api/reports/finance": () => (fail ? { status: 500, body: { detail: "Server error." } } : { status: 200, body: finance() }) } });
    const user = userEvent.setup();
    renderApp("/reports?period=year&year=2025");
    expect(await screen.findByText(/Couldn't load the report/)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: /Monthly finance · 2025/ })).toBeInTheDocument();
  });
});
