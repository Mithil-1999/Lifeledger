import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartCard } from "@/components/charts/chart-card";
import { ExpenseCategoryChart } from "@/components/charts/expense-category-chart";
import { IncomeExpenseChart } from "@/components/charts/income-expense-chart";
import { MonthlySpendingChart } from "@/components/charts/monthly-spending-chart";
import { SavingsChart } from "@/components/charts/savings-chart";
import { formatDate, formatMoney, greeting } from "@/lib/format";
import { emptyDashboard, mockApi, renderApp } from "./utils";

afterEach(() => vi.unstubAllGlobals());

describe("authenticated dashboard", () => {
  it("greets the user by first name with the current period", async () => {
    mockApi();
    renderApp("/dashboard");
    // CLDR versions differ on "Sep" vs "Sept", so don't pin the abbreviation.
    expect(await screen.findByText(/Mithil\. Here's September 2026 at a glance, as of Thu, 24 Sept? 2026\./)).toBeInTheDocument();
  });

  it("shows empty states instead of statistics when no financial data exists", async () => {
    mockApi();
    renderApp("/dashboard");
    const finance = await screen.findByRole("region", { name: "Financial summary" });
    for (const label of ["Monthly income", "Monthly expenses", "Current balance", "Savings", "Budget remaining"]) {
      expect(within(finance).getByText(label, { selector: "span.text-sm" })).toBeInTheDocument();
    }
    await waitFor(() => expect(within(finance).getAllByText("No data yet")).toHaveLength(5));
    expect(within(finance).getByText(/Figures appear once you start recording income and expenses \(Phase 4\)/)).toBeInTheDocument();
    // No numbers are invented.
    expect(within(finance).queryByText(/NPR/)).not.toBeInTheDocument();
  });

  it("shows task, bill and reminder empty states and switches tabs", async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp("/dashboard");

    expect(await screen.findByText("Today tasks will appear here")).toBeInTheDocument();
    const taskTabs = screen.getByRole("tablist", { name: "Task views" });
    await user.click(within(taskTabs).getByRole("tab", { name: "Overdue" }));
    expect(await screen.findByText("Overdue tasks will appear here")).toBeInTheDocument();

    expect(screen.getByText("Upcoming bills will appear here")).toBeInTheDocument();
    const billTabs = screen.getByRole("tablist", { name: "Bill views" });
    await user.click(within(billTabs).getByRole("tab", { name: "Overdue" }));
    expect(await screen.findByText("Overdue bills will appear here")).toBeInTheDocument();

    expect(screen.getByText("Reminders will appear here")).toBeInTheDocument();
    expect(screen.getByText(/The task system arrives in Phase 6/)).toBeInTheDocument();
  });

  it("shows empty states for all four charts", async () => {
    mockApi();
    renderApp("/dashboard");
    for (const title of ["Income vs expenses", "Expense categories", "Monthly spending", "Savings"]) {
      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(await screen.findAllByText(/Charts fill in automatically once you record income and expenses \(Phase 4\)/)).toHaveLength(4);
  });

  it("quick actions explain the feature is coming instead of pretending to work", async () => {
    mockApi();
    const user = userEvent.setup();
    const { router } = renderApp("/dashboard");

    for (const label of ["Add income", "Add expense"]) {
      expect(await screen.findByRole("link", { name: label })).toBeInTheDocument();
    }
    for (const label of ["Add task", "Add reminder", "Add bill"]) {
      expect(await screen.findByRole("button", { name: label })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "Add task" }));
    const dialog = await screen.findByRole("dialog", { name: "Add task: coming in Phase 6" });
    expect(within(dialog).getByText(/nothing can be saved here/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("link", { name: "Open Tasks" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/tasks"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Add expense opens the real expense form", async () => {
    mockApi();
    const user = userEvent.setup();
    const { router } = renderApp("/dashboard");
    await user.click(await screen.findByRole("link", { name: "Add expense" }));
    expect(await screen.findByRole("dialog", { name: "Add expense" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/expenses");
    // The one-shot ?new=1 flag is removed so a reload doesn't reopen the form.
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("closes the quick action dialog with Escape", async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp("/dashboard");
    await user.click(await screen.findByRole("button", { name: "Add bill" }));
    expect(await screen.findByRole("dialog", { name: "Add bill: coming in Phase 5" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows an error with retry when the summary can't load", async () => {
    mockApi({ routes: { "GET /api/dashboard/summary": { status: 500, body: { detail: "Internal server error." } } } });
    renderApp("/dashboard");
    expect(await screen.findByText(/Couldn't load your dashboard/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("links from module shortcuts to their pages", async () => {
    mockApi();
    const user = userEvent.setup();
    const { router } = renderApp("/dashboard");
    const modules = await screen.findByRole("region", { name: "All modules" });
    await user.click(within(modules).getByRole("link", { name: /Reports/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/reports"));
  });
});

describe("unauthenticated", () => {
  it("redirects the dashboard to login without requesting personal data", async () => {
    const fetchMock = mockApi({ user: null });
    const { router } = renderApp("/dashboard");
    expect(await screen.findByRole("heading", { name: "Sign in to LifeVault" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/dashboard/summary")).toBe(false);
  });
});

describe("dashboard with real data (contract for later phases)", () => {
  it("formats money from the API in NPR with lakh grouping", async () => {
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
              monthly_income: money("150000.00"),
              monthly_expenses: money("48250.50"),
              current_balance: money("1234567.00"),
              savings: money("300000.00"),
              budget_remaining: money("11749.50"),
            },
          },
        },
      },
    });
    renderApp("/dashboard");
    expect(await screen.findByText("NPR 1,50,000.00")).toBeInTheDocument();
    expect(screen.getByText("NPR 48,250.50")).toBeInTheDocument();
    expect(screen.getByText("NPR 12,34,567.00")).toBeInTheDocument();
  });

  it("shows real figures with savings and budget marked as coming in Phase 5", async () => {
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
              monthly_expenses: money("15000.50"),
              current_balance: money("-200.00"),
              savings: null,
              budget_remaining: null,
              pending: { savings: 5, budget_remaining: 5 },
            },
            charts: { ...emptyDashboard.charts, available: true, available_from_phase: null, pending: { savings: 5 } },
          },
        },
      },
    });
    renderApp("/dashboard");
    const finance = await screen.findByRole("region", { name: "Financial summary" });
    expect(await within(finance).findByText("NPR 85,000.00")).toBeInTheDocument();
    expect(within(finance).getByText("-NPR 200.00")).toBeInTheDocument();
    expect(within(finance).getAllByText("Arrives in Phase 5")).toHaveLength(2);
    expect(within(finance).queryByText(/Figures appear once/)).not.toBeInTheDocument();
    expect(await screen.findByText("Savings tracking arrives in Phase 5.")).toBeInTheDocument();
    expect(screen.getAllByText("Record income and expenses to see this chart.")).toHaveLength(3);
  });
});

describe("reusable chart components", () => {
  // Sample data lives only in tests; the app never shows invented numbers.
  const months = [
    { month: "2026-08", income: 120000, expenses: 45000 },
    { month: "2026-09", income: 150000, expenses: 48250.5 },
  ];

  it("IncomeExpenseChart exposes its data accessibly", () => {
    render(<IncomeExpenseChart data={months} currency="NPR" />);
    const table = screen.getByRole("table", { name: "Income vs expenses by month" });
    expect(within(table).getByRole("rowheader", { name: /^Sept? 2026$/ })).toBeInTheDocument();
    expect(within(table).getByText("NPR 1,50,000.00")).toBeInTheDocument();
  });

  it("ExpenseCategoryChart shows each category's share", () => {
    render(
      <ExpenseCategoryChart
        data={[
          { category: "Food", amount: 7500 },
          { category: "Rent", amount: 22500 },
        ]}
        currency="NPR"
      />,
    );
    const table = screen.getByRole("table", { name: "Expenses by category" });
    expect(within(table).getByText("25%")).toBeInTheDocument();
    expect(within(table).getByText("75%")).toBeInTheDocument();
  });

  it("MonthlySpendingChart and SavingsChart render their tables", () => {
    render(
      <>
        <MonthlySpendingChart data={[{ month: "2026-09", amount: 48250.5 }]} currency="NPR" />
        <SavingsChart data={[{ month: "2026-09", amount: 300000 }]} currency="NPR" />
      </>,
    );
    expect(screen.getByRole("table", { name: "Spending by month" })).toHaveTextContent("NPR 48,250.50");
    expect(screen.getByRole("table", { name: "Savings balance by month" })).toHaveTextContent("NPR 3,00,000.00");
  });

  it("ChartCard renders loading, empty and ready states", () => {
    const { rerender } = render(<ChartCard title="Chart" state="loading" />);
    expect(screen.queryByText("No data yet")).not.toBeInTheDocument();
    rerender(<ChartCard title="Chart" state="empty" emptyDescription="Nothing recorded." />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    rerender(
      <ChartCard title="Chart" state="ready">
        <p>chart body</p>
      </ChartCard>,
    );
    expect(screen.getByText("chart body")).toBeInTheDocument();
  });
});

describe("formatting helpers", () => {
  // Intl separates the code and number with a non-breaking space (keeps them on one line).
  const plain = (s: string) => s.replaceAll(String.fromCharCode(0xa0), " ");

  it("formats money exactly from decimal strings", () => {
    expect(plain(formatMoney({ amount: "1234567.5", currency: "NPR" }))).toBe("NPR 12,34,567.50");
    expect(formatMoney({ amount: "not-a-number", currency: "NPR" })).toBe("—");
  });

  it("treats date-only strings as calendar dates (no timezone shift)", () => {
    // Midnight UTC on the 1st would be the 31st in a western timezone if parsed as an instant.
    expect(formatDate("2026-09-01")).toMatch(/^Tue, 1 Sept? 2026$/);
  });

  it("greets by time of day", () => {
    expect(greeting(8)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
  });
});
