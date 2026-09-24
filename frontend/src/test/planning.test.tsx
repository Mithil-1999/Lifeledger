import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bill, Budget, SavingsGoal } from "@/features/planning/api";
import { dueLabel, shiftMonth } from "@/features/planning/constants";
import { emptyBills, emptyBudgetMonth, emptyDashboard, emptySavings, expenseCategories, mockApi, renderApp, sentBody } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const food = expenseCategories.find((c) => c.name === "Food")!;
const rent = expenseCategories.find((c) => c.name === "Rent")!;

function budget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: "b-food",
    category: food,
    month: "2026-09",
    amount: "1000.00",
    warning_threshold: 80,
    spent: "850.30",
    remaining: "149.70",
    percent_used: "85.0",
    status: "warning",
    ...overrides,
  };
}

function bill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: "bill-rent",
    name: "Room rent",
    amount: "12000.00",
    currency: "NPR",
    category: "rent",
    due_date: "2026-10-01",
    frequency: "monthly",
    status: "pending",
    days_until_due: 7,
    notes: null,
    last_paid_on: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: "goal-1",
    name: "Emergency fund",
    target_amount: "100000.00",
    current_amount: "25000.50",
    currency: "NPR",
    target_date: "2027-09-24",
    description: null,
    progress_percent: "25.0",
    remaining_amount: "74999.50",
    completed: false,
    monthly_needed: "5769.20",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

// --- Budget ---------------------------------------------------------------------------------------

describe("budget page", () => {
  it("shows budget, spent, remaining, percentage and status", async () => {
    mockApi({
      routes: {
        "GET /api/budgets": {
          status: 200,
          body: {
            ...emptyBudgetMonth,
            total_budget: "13000.00",
            total_spent: "13350.30",
            total_remaining: "-350.30",
            percent_used: "102.7",
            unbudgeted_spent: "500.00",
            budgets: [
              budget(),
              budget({ id: "b-rent", category: rent, amount: "12000.00", spent: "12500.00", remaining: "-500.00", percent_used: "104.2", status: "over" }),
            ],
          },
        },
      },
    });
    renderApp("/budget");
    const list = await screen.findByRole("list", { name: "Budgets" });
    const [foodCard, rentCard] = within(list).getAllByRole("listitem");
    expect(within(foodCard).getByText("Food")).toBeInTheDocument();
    expect(within(foodCard).getByText("Near limit")).toBeInTheDocument();
    expect(within(foodCard).getByText("NPR 850.30")).toBeInTheDocument();
    expect(within(foodCard).getByText("NPR 149.70")).toBeInTheDocument();
    expect(within(foodCard).getByRole("progressbar", { name: /Food: 85.0% of budget used/ })).toHaveAttribute("aria-valuenow", "85");
    expect(within(rentCard).getByText("Over budget")).toBeInTheDocument();
    expect(within(rentCard).getByText("Over by")).toBeInTheDocument();
    expect(within(rentCard).getByText("NPR 500.00")).toBeInTheDocument();
    expect(screen.getByText("NPR 350.30 over budget")).toBeInTheDocument();
    expect(screen.getByText(/Plus NPR 500.00 spent in categories without a budget/)).toBeInTheDocument();
  });

  it("adds a budget with a custom warning threshold", async () => {
    const fetchMock = mockApi({ routes: { "POST /api/budgets": { status: 201, body: budget() } } });
    const user = userEvent.setup();
    renderApp("/budget");
    expect(await screen.findByText(/No budgets for/)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Add budget" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add budget" });
    await within(dialog).findByRole("option", { name: "Food" });
    await user.selectOptions(within(dialog).getByLabelText("Category"), food.id);
    await user.type(within(dialog).getByLabelText("Monthly limit (NPR)"), "1,000");
    await user.clear(within(dialog).getByLabelText("Warn at (%)"));
    await user.type(within(dialog).getByLabelText("Warn at (%)"), "90");
    await user.click(within(dialog).getByRole("button", { name: "Add budget" }));

    await waitFor(() =>
      expect(sentBody(fetchMock, "POST", "/api/budgets")).toEqual({
        category_id: food.id,
        month: expect.stringMatching(/^\d{4}-\d{2}$/),
        amount: "1000",
        warning_threshold: 90,
      }),
    );
    expect(await screen.findByText("Budget added.")).toBeInTheDocument();
  });

  it("validates the threshold range", async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp("/budget");
    await user.click((await screen.findAllByRole("button", { name: "Add budget" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add budget" });
    await user.clear(within(dialog).getByLabelText("Warn at (%)"));
    await user.type(within(dialog).getByLabelText("Warn at (%)"), "150");
    await user.click(within(dialog).getByRole("button", { name: "Add budget" }));
    expect(await within(dialog).findByText("Use 1–100.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose a category.")).toBeInTheDocument();
  });

  it("copies last month's budgets and navigates months", async () => {
    const fetchMock = mockApi({ routes: { "POST /api/budgets/copy": { status: 200, body: { copied: 2, skipped: 0 } } } });
    const user = userEvent.setup();
    renderApp("/budget");
    const monthInput = await screen.findByLabelText("Budget month");
    const month = (monthInput as HTMLInputElement).value;
    await user.click(screen.getAllByRole("button", { name: /Copy from/ })[0]);
    await waitFor(() => expect(sentBody(fetchMock, "POST", "/api/budgets/copy")).toEqual({ from_month: shiftMonth(month, -1), to_month: month }));
    expect(await screen.findByText(/Copied 2 budgets/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(monthInput).toHaveValue(shiftMonth(month, 1));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === `/api/budgets?month=${shiftMonth(month, 1)}`)).toBe(true));
  });
});

// --- Bills ------------------------------------------------------------------------------------------

describe("bills page", () => {
  const overview = {
    ...emptyBills,
    items: [
      bill({ id: "bill-elec", name: "Electricity", category: "electricity", amount: "1850.50", status: "overdue", days_until_due: -3, due_date: "2026-09-21" }),
      bill({ last_paid_on: "2026-09-01" }),
      bill({ id: "bill-old", name: "Laptop repair", category: "other", frequency: "one_time", status: "paid", amount: "3000.00" }),
    ],
    overdue_count: 1,
    overdue_total: "1850.50",
    due_soon_count: 1,
    due_soon_total: "12000.00",
    paid_this_month_total: "12000.00",
  };

  it("shows statuses, due labels and summary totals", async () => {
    mockApi({ routes: { "GET /api/bills": { status: 200, body: overview } } });
    renderApp("/bills");
    const list = await screen.findByRole("list", { name: "Bills" });
    const [elec, rentBill, repair] = within(list).getAllByRole("listitem");
    expect(within(elec).getByText("Overdue")).toBeInTheDocument();
    expect(within(elec).getByText(/3 days overdue/)).toBeInTheDocument();
    expect(within(rentBill).getByText("Pending")).toBeInTheDocument();
    expect(within(rentBill).getByText(/Due in 7 days/)).toBeInTheDocument();
    expect(within(rentBill).getByText(/Last paid/)).toBeInTheDocument();
    expect(within(repair).getByText("Paid")).toBeInTheDocument();
    expect(within(repair).queryByRole("button", { name: /Mark as paid/ })).not.toBeInTheDocument();
    expect(screen.getByText("Overdue (1)")).toBeInTheDocument();
    // On the overdue bill card and in the overdue total.
    expect(screen.getAllByText("NPR 1,850.50")).toHaveLength(2);
  });

  it("filters by status tab", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/bills": { status: 200, body: overview } } });
    const user = userEvent.setup();
    renderApp("/bills");
    await screen.findByRole("list", { name: "Bills" });
    await user.click(screen.getByRole("tab", { name: "Overdue" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/bills?status=overdue", expect.anything()));
  });

  it("adds a bill", async () => {
    const fetchMock = mockApi({ routes: { "POST /api/bills": { status: 201, body: bill() } } });
    const user = userEvent.setup();
    renderApp("/bills?new=1");
    const dialog = await screen.findByRole("dialog", { name: "Add bill" });
    await user.type(within(dialog).getByLabelText("Name"), "Worldlink Wi-Fi");
    await user.type(within(dialog).getByLabelText("Amount (NPR)"), "1500");
    await user.selectOptions(within(dialog).getByLabelText("Category"), "wifi");
    await user.clear(within(dialog).getByLabelText("Due date"));
    await user.type(within(dialog).getByLabelText("Due date"), "2026-10-05");
    await user.click(within(dialog).getByRole("button", { name: "Add bill" }));
    await waitFor(() =>
      expect(sentBody(fetchMock, "POST", "/api/bills")).toEqual({
        name: "Worldlink Wi-Fi",
        amount: "1500",
        category: "wifi",
        due_date: "2026-10-05",
        frequency: "monthly",
        notes: null,
        status: "pending",
      }),
    );
  });

  it("marks a bill as paid and records the expense", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/bills": { status: 200, body: overview },
        "POST /api/bills/bill-rent/pay": { status: 200, body: bill({ due_date: "2026-11-01", days_until_due: 38 }) },
      },
    });
    const user = userEvent.setup();
    renderApp("/bills");
    const list = await screen.findByRole("list", { name: "Bills" });
    const rentCard = within(list).getAllByRole("listitem")[1];
    await user.click(within(rentCard).getByRole("button", { name: /Mark as paid/ }));

    const dialog = await screen.findByRole("dialog", { name: "Mark Room rent as paid" });
    expect(within(dialog).getByText("The bill will move to its next due date.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Amount paid (NPR)")).toHaveValue("12000.00");
    expect(within(dialog).getByLabelText(/Also record this payment as an expense/)).toBeChecked();
    await user.selectOptions(within(dialog).getByLabelText("Payment method"), "mobile_wallet");
    await user.click(within(dialog).getByRole("button", { name: "Mark as paid" }));

    await waitFor(() =>
      expect(sentBody(fetchMock, "POST", "/api/bills/bill-rent/pay")).toMatchObject({
        amount: "12000.00",
        record_expense: true,
        payment_method: "mobile_wallet",
      }),
    );
    expect(await screen.findByText(/Room rent paid\. Next due/)).toBeInTheDocument();
  });

  it("shows payment history", async () => {
    mockApi({
      routes: {
        "GET /api/bills": { status: 200, body: overview },
        "GET /api/bills/bill-rent/payments": {
          status: 200,
          body: [{ id: "p1", amount: "12000.00", paid_on: "2026-09-01", due_date: "2026-09-01", expense_id: "e1" }],
        },
      },
    });
    const user = userEvent.setup();
    renderApp("/bills");
    await user.click(await screen.findByRole("button", { name: "Actions for Room rent" }));
    await user.click(await screen.findByRole("menuitem", { name: /Payment history/ }));
    const dialog = await screen.findByRole("dialog", { name: "Room rent: payment history" });
    expect(await within(dialog).findByText(/recorded as expense/)).toBeInTheDocument();
  });

  it("formats due labels", () => {
    expect(dueLabel(0)).toBe("Due today");
    expect(dueLabel(1)).toBe("Due tomorrow");
    expect(dueLabel(5)).toBe("Due in 5 days");
    expect(dueLabel(-1)).toBe("1 day overdue");
    expect(dueLabel(-4)).toBe("4 days overdue");
  });
});

// --- Savings --------------------------------------------------------------------------------------------

describe("savings page", () => {
  const savings = { ...emptySavings, total_saved: "25000.50", total_target: "100000.00", progress_percent: "25.0", goals: [goal()] };

  it("shows goal progress and what's needed per month", async () => {
    mockApi({ routes: { "GET /api/savings-goals": { status: 200, body: savings } } });
    renderApp("/savings");
    const list = await screen.findByRole("list", { name: "Savings goals" });
    const card = within(list).getByRole("listitem");
    expect(within(card).getByText("NPR 25,000.50")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar", { name: /Emergency fund: 25.0% saved/ })).toBeInTheDocument();
    expect(within(card).getByText(/NPR 74,999.50 to go/)).toHaveTextContent("NPR 5,769.20/month to reach it on time");
    expect(screen.getByText("25.0%")).toBeInTheDocument();
  });

  it("creates a goal", async () => {
    const fetchMock = mockApi({ routes: { "POST /api/savings-goals": { status: 201, body: goal() } } });
    const user = userEvent.setup();
    renderApp("/savings");
    await user.click((await screen.findAllByRole("button", { name: "New goal" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "New savings goal" });
    await user.type(within(dialog).getByLabelText("Name"), "Laptop");
    await user.type(within(dialog).getByLabelText("Target amount (NPR)"), "150000");
    await user.click(within(dialog).getByRole("button", { name: "Create goal" }));
    await waitFor(() =>
      expect(sentBody(fetchMock, "POST", "/api/savings-goals")).toEqual({
        name: "Laptop",
        target_amount: "150000",
        current_amount: "0",
        target_date: null,
        description: null,
      }),
    );
  });

  it("adds money and shows the API error for an impossible withdrawal", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/savings-goals": { status: 200, body: savings },
        "POST /api/savings-goals/goal-1/contributions": (init) =>
          JSON.parse(String(init.body)).kind === "deposit"
            ? { status: 200, body: goal({ current_amount: "30000.50" }) }
            : { status: 422, body: { detail: "You can't withdraw more than this goal's balance." } },
      },
    });
    const user = userEvent.setup();
    renderApp("/savings");
    await user.click(await screen.findByRole("button", { name: /Add money/ }));
    let dialog = await screen.findByRole("dialog", { name: "Add money to Emergency fund" });
    await user.type(within(dialog).getByLabelText("Amount (NPR)"), "5000");
    await user.click(within(dialog).getByRole("button", { name: "Add money" }));
    await waitFor(() =>
      expect(sentBody(fetchMock, "POST", "/api/savings-goals/goal-1/contributions")).toMatchObject({ kind: "deposit", amount: "5000" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Withdraw/ }));
    dialog = await screen.findByRole("dialog", { name: "Withdraw from Emergency fund" });
    await user.type(within(dialog).getByLabelText("Amount (NPR)"), "999999");
    await user.click(within(dialog).getByRole("button", { name: "Withdraw" }));
    expect(await within(dialog).findByText("You can't withdraw more than this goal's balance.")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    mockApi();
    renderApp("/savings");
    expect(await screen.findByText("No savings goals yet")).toBeInTheDocument();
  });
});

// --- Dashboard ----------------------------------------------------------------------------------------------

describe("dashboard integration", () => {
  it("shows real bills and budget/savings figures", async () => {
    const money = (amount: string) => ({ amount, currency: "NPR" });
    mockApi({
      routes: {
        "GET /api/dashboard/summary": {
          status: 200,
          body: {
            ...emptyDashboard,
            finance: {
              available: true,
              available_from_phase: null,
              monthly_income: money("85000.00"),
              monthly_expenses: money("700.00"),
              current_balance: money("84300.00"),
              savings: money("8000.25"),
              budget_remaining: money("12300.00"),
              pending: {},
              not_configured: [],
            },
            bills: {
              available: true,
              available_from_phase: null,
              upcoming: [{ id: "b1", name: "Wi-Fi", amount: money("1500.00"), due_date: "2026-09-27" }],
              overdue: [{ id: "b2", name: "Electricity", amount: money("1850.50"), due_date: "2026-09-22" }],
            },
          },
        },
      },
    });
    const user = userEvent.setup();
    renderApp("/dashboard");
    const finance = await screen.findByRole("region", { name: "Financial summary" });
    expect(await within(finance).findByText("NPR 8,000.25")).toBeInTheDocument();
    expect(within(finance).getByText("NPR 12,300.00")).toBeInTheDocument();

    expect(screen.getByText("Wi-Fi")).toBeInTheDocument();
    const billTabs = screen.getByRole("tablist", { name: "Bill views" });
    await user.click(within(billTabs).getByRole("tab", { name: "Overdue" }));
    expect(await screen.findByText("Electricity")).toBeInTheDocument();
    expect(screen.getByText("NPR 1,850.50")).toBeInTheDocument();
  });

  it("invites setup when there are no budgets or goals", async () => {
    const money = (amount: string) => ({ amount, currency: "NPR" });
    mockApi({
      routes: {
        "GET /api/dashboard/summary": {
          status: 200,
          body: {
            ...emptyDashboard,
            finance: {
              available: true,
              available_from_phase: null,
              monthly_income: money("0.00"),
              monthly_expenses: money("0.00"),
              current_balance: money("0.00"),
              savings: null,
              budget_remaining: null,
              pending: {},
              not_configured: ["savings", "budget_remaining"],
            },
            bills: { available: true, available_from_phase: null, upcoming: [], overdue: [] },
            charts: { ...emptyDashboard.charts, available: true, available_from_phase: null },
          },
        },
      },
    });
    renderApp("/dashboard");
    const finance = await screen.findByRole("region", { name: "Financial summary" });
    expect(await within(finance).findByText("No savings goals yet")).toBeInTheDocument();
    expect(within(finance).getByText("No budget set for this month")).toBeInTheDocument();
    expect(screen.getByText("No upcoming bills.")).toBeInTheDocument();
    // Charts are lazy-loaded.
    expect(await screen.findByText("Create a savings goal and add money to see your savings grow.")).toBeInTheDocument();
  });
});
