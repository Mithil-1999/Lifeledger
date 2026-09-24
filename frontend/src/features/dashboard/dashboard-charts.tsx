import { ChartCard, type ChartState } from "@/components/charts/chart-card";
import { toNumber } from "@/components/charts/chart-utils";
import { ExpenseCategoryChart } from "@/components/charts/expense-category-chart";
import { IncomeExpenseChart } from "@/components/charts/income-expense-chart";
import { MonthlySpendingChart } from "@/components/charts/monthly-spending-chart";
import { SavingsChart } from "@/components/charts/savings-chart";
import type { DashboardSummary } from "./api";

export function DashboardCharts({ summary, loading }: { summary?: DashboardSummary; loading: boolean }) {
  const charts = summary?.charts;
  const currency = summary?.currency ?? "NPR";
  const stateFor = (length: number): ChartState => (loading || !charts ? "loading" : length > 0 ? "ready" : "empty");
  const emptyDescription =
    charts && !charts.available
      ? `Charts fill in automatically once you record income and expenses (Phase ${charts.available_from_phase}).`
      : "Record income and expenses to see this chart.";
  const savingsPhase = charts?.pending?.savings;
  const savingsDescription = savingsPhase ? `Savings tracking arrives in Phase ${savingsPhase}.` : emptyDescription;

  const incomeVsExpenses = (charts?.income_vs_expenses ?? []).map((p) => ({
    month: p.month,
    income: toNumber(p.income),
    expenses: toNumber(p.expenses),
  }));
  const categories = (charts?.expense_categories ?? []).map((p) => ({ category: p.category, amount: toNumber(p.amount) }));
  const spending = (charts?.monthly_spending ?? []).map((p) => ({ month: p.month, amount: toNumber(p.expenses) }));
  // Amounts are converted to numbers only here, for plotting; all totals were computed exactly on the server.
  const savings = (charts?.savings ?? []).map((p) => ({ month: p.month, amount: toNumber(p.savings) }));

  return (
    <section aria-labelledby="charts-heading" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <h2 id="charts-heading" className="sr-only">
        Charts
      </h2>
      <ChartCard title="Income vs expenses" description="Last 6 months" state={stateFor(incomeVsExpenses.length)} emptyDescription={emptyDescription}>
        <IncomeExpenseChart data={incomeVsExpenses} currency={currency} />
      </ChartCard>
      <ChartCard title="Expense categories" description="This month" state={stateFor(categories.length)} emptyDescription={emptyDescription}>
        <ExpenseCategoryChart data={categories} currency={currency} />
      </ChartCard>
      <ChartCard title="Monthly spending" description="Last 6 months" state={stateFor(spending.length)} emptyDescription={emptyDescription}>
        <MonthlySpendingChart data={spending} currency={currency} />
      </ChartCard>
      <ChartCard title="Savings" description="Balance over time" state={stateFor(savings.length)} emptyDescription={savingsDescription}>
        <SavingsChart data={savings} currency={currency} />
      </ChartCard>
    </section>
  );
}
