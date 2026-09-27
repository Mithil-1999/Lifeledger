import * as React from "react";
import { Link } from "react-router";
import { Info } from "lucide-react";
import { toNumber } from "@/components/charts/chart-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BILL_CATEGORIES, BILL_FREQUENCIES } from "@/features/planning/constants";
import type { BillCategory, BillFrequency } from "@/features/planning/api";
import { formatDate, formatMonth } from "@/lib/format";
import type { BillBrief, BillsReport, BudgetReport, ExpenseReport, FinanceReport, ReportPeriod, SavingsReport } from "./api";
import { isNegative, isZero, money, pct } from "./format";
import { ChangeText, DataTable, Figure, FigureGrid, LazyChart, Section } from "./report-ui";

const IncomeExpenseChart = React.lazy(() => import("@/components/charts/income-expense-chart").then((m) => ({ default: m.IncomeExpenseChart })));
const ExpenseCategoryChart = React.lazy(() => import("@/components/charts/expense-category-chart").then((m) => ({ default: m.ExpenseCategoryChart })));
const MonthlyTotalsChart = React.lazy(() => import("@/components/charts/monthly-totals-chart").then((m) => ({ default: m.MonthlyTotalsChart })));
const TrendLineChart = React.lazy(() => import("@/components/charts/trend-line-chart").then((m) => ({ default: m.TrendLineChart })));
const BudgetActualChart = React.lazy(() => import("@/components/charts/budget-actual-chart").then((m) => ({ default: m.BudgetActualChart })));

const shortDate = (iso: string) => formatDate(iso, { day: "numeric", month: "short", year: "numeric" });

/** e.g. "Last 6 months up to Feb 2025" for a single month, otherwise the period itself. */
function trendLabel(period: ReportPeriod) {
  if (period.kind === "month") return `${period.trend_months.length} months up to ${formatMonth(period.months[0])}`;
  return period.label;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

// --- Monthly finance ---------------------------------------------------------------------------------------------

export function FinanceSection({ data }: { data: FinanceReport }) {
  const { totals, currency } = data;
  const trend = data.months;
  const hasActivity = trend.some((m) => !isZero(m.income) || !isZero(m.expenses));
  return (
    <div className="grid grid-cols-1 gap-4">
      <FigureGrid>
        <Figure label="Income" value={money(totals.income, currency)} />
        <Figure label="Expenses" value={money(totals.expenses, currency)} />
        <Figure
          label="Net (income − expenses)"
          value={money(totals.net, currency)}
          tone={isZero(totals.net) ? "default" : isNegative(totals.net) ? "negative" : "positive"}
          hint={totals.savings_rate === null ? "No income in this period, so there's no savings rate." : `You kept ${totals.savings_rate}% of your income.`}
        />
        <Figure
          label="Balance"
          value={totals.closing_balance === null ? "—" : money(totals.closing_balance, currency)}
          tone={totals.closing_balance === null ? "muted" : "default"}
          hint={totals.balance_as_of ? `All income minus all expenses, as of ${shortDate(totals.balance_as_of)}.` : "This period hasn't started yet."}
        />
      </FigureGrid>
      <Note>
        Added to savings goals in this period: <strong className="text-foreground">{money(totals.savings, currency)}</strong> (deposits {money(totals.savings_deposits, currency)}, withdrawals{" "}
        {money(totals.savings_withdrawals, currency)}). This includes starting balances entered when a goal was created.
      </Note>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LazyChart title="Income vs expenses" description={trendLabel(data.period)} empty={!hasActivity} emptyDescription="Record income and expenses to see this chart.">
          <IncomeExpenseChart data={trend.map((m) => ({ month: m.month, income: toNumber(m.income), expenses: toNumber(m.expenses) }))} currency={currency} />
        </LazyChart>
        <LazyChart title="Balance" description="At the end of each month" empty={!trend.some((m) => m.balance !== null && !isZero(m.balance))} emptyDescription="Your balance appears once you have income or expenses.">
          <TrendLineChart data={trend.map((m) => ({ month: m.month, amount: m.balance === null ? null : toNumber(m.balance) }))} currency={currency} label="Balance" color="var(--chart-5)" />
        </LazyChart>
      </div>
      <Section title="Month by month" description={trendLabel(data.period)}>
        <DataTable
          caption="Monthly finance"
          rows={trend}
          rowKey={(m) => m.month}
          columns={[
            { header: "Month", cell: (m) => formatMonth(m.month) },
            { header: "Income", align: "right", cell: (m) => money(m.income, currency) },
            { header: "Expenses", align: "right", cell: (m) => money(m.expenses, currency) },
            { header: "Net", align: "right", cell: (m) => <span className={isNegative(m.net) ? "text-destructive" : undefined}>{money(m.net, currency)}</span> },
            { header: "To savings", align: "right", cell: (m) => money(m.savings, currency) },
            { header: "Balance", align: "right", cell: (m) => (m.balance === null ? "—" : money(m.balance, currency)) },
          ]}
        />
      </Section>
    </div>
  );
}

// --- Expenses -------------------------------------------------------------------------------------------------------

export function ExpensesSection({ data }: { data: ExpenseReport }) {
  const { currency } = data;
  const spent = data.by_category.filter((c) => !isZero(c.amount));
  const largest = data.largest[0];
  return (
    <div className="grid grid-cols-1 gap-4">
      <FigureGrid>
        <Figure label="Total spent" value={money(data.total, currency)} hint={`${data.count} expense${data.count === 1 ? "" : "s"}`} />
        <Figure
          label="Vs previous period"
          value={<ChangeText change={data.previous.change} currency={currency} className="text-base sm:text-lg" />}
          hint={`${shortDate(data.previous.start)} – ${shortDate(data.previous.end)}: ${money(data.previous.total, currency)}`}
        />
        <Figure label="Recurring expenses" value={money(data.recurring.total, currency)} hint={data.recurring.percent_of_total === null ? "No spending in this period." : `${data.recurring.percent_of_total}% of spending · ${data.recurring.count} entries`} />
        <Figure label="Largest expense" value={largest ? money(largest.amount, currency) : "—"} tone={largest ? "default" : "muted"} hint={largest ? `${largest.category} · ${shortDate(largest.date)}` : "No expenses in this period."} />
      </FigureGrid>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LazyChart title="By category" description={data.period.label} empty={spent.length === 0} emptyDescription="No expenses in this period.">
          <ExpenseCategoryChart data={spent.map((c) => ({ category: c.category, amount: toNumber(c.amount) }))} currency={currency} />
        </LazyChart>
        <LazyChart title="Monthly spending" description={trendLabel(data.period)} empty={data.monthly.every((m) => isZero(m.amount))} emptyDescription="No expenses in these months.">
          <MonthlyTotalsChart data={data.monthly.map((m) => ({ month: m.month, amount: toNumber(m.amount) }))} currency={currency} label="Spent" color="var(--chart-4)" />
        </LazyChart>
      </div>
      <Section title="Category breakdown" description="Share of this period's spending, compared with the previous period.">
        <DataTable
          caption="Expenses by category"
          rows={data.by_category}
          rowKey={(c) => c.category_id}
          empty="No expenses in this period or the previous one."
          columns={[
            { header: "Category", cell: (c) => c.category },
            { header: "Spent", align: "right", cell: (c) => money(c.amount, currency) },
            { header: "Share", align: "right", cell: (c) => pct(c.percent) },
            { header: "Entries", align: "right", cell: (c) => c.count },
            { header: "Previous", align: "right", cell: (c) => money(c.previous_amount, currency) },
            { header: "Change", align: "right", cell: (c) => <ChangeText change={c.change} currency={currency} /> },
          ]}
          footer={["Total", money(data.total, currency), data.count > 0 ? "100%" : "—", String(data.count), money(data.previous.total, currency), <ChangeText key="c" change={data.previous.change} currency={currency} />]}
        />
      </Section>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Largest expenses" description={`Top ${data.largest.length || 10} in this period`}>
          <DataTable
            caption="Largest expenses"
            rows={data.largest}
            rowKey={(e) => e.id}
            empty="No expenses in this period."
            columns={[
              { header: "Date", cell: (e) => shortDate(e.date) },
              { header: "Category", cell: (e) => e.category },
              { header: "Description", cell: (e) => <span className="block max-w-56 truncate">{e.description ?? "—"}</span> },
              { header: "Amount", align: "right", cell: (e) => money(e.amount, currency) },
            ]}
          />
        </Section>
        <Section title="Recurring expenses" description="Expenses marked as recurring, grouped by what they're for.">
          <DataTable
            caption="Recurring expenses"
            rows={data.recurring.items}
            rowKey={(r, i) => `${r.category}-${r.description}-${r.interval}-${i}`}
            empty="No recurring expenses in this period."
            columns={[
              { header: "Expense", cell: (r) => r.description ?? r.category },
              { header: "Repeats", cell: (r) => (r.interval ? r.interval[0].toUpperCase() + r.interval.slice(1) : "—") },
              { header: "Times", align: "right", cell: (r) => r.count },
              { header: "Total", align: "right", cell: (r) => money(r.total, currency) },
            ]}
          />
        </Section>
      </div>
      <Section title="Monthly comparison" description="Each month compared with the month before.">
        <DataTable
          caption="Monthly spending comparison"
          rows={data.monthly}
          rowKey={(m) => m.month}
          columns={[
            { header: "Month", cell: (m) => formatMonth(m.month) },
            { header: "Spent", align: "right", cell: (m) => money(m.amount, currency) },
            { header: "Vs previous month", align: "right", cell: (m) => <ChangeText change={m.change} currency={currency} /> },
          ]}
        />
      </Section>
    </div>
  );
}

// --- Budget -------------------------------------------------------------------------------------------------------------

export function BudgetSection({ data }: { data: BudgetReport }) {
  const { totals, currency } = data;
  const multiMonth = data.months.length > 1;
  if (data.categories.length === 0) {
    return (
      <Section title="No budgets in this period" description="Set monthly budgets to compare them with what you actually spent.">
        <Button asChild>
          <Link to="/budget">Set a budget</Link>
        </Button>
      </Section>
    );
  }
  const overspent = isNegative(totals.remaining);
  return (
    <div className="grid grid-cols-1 gap-4">
      {data.period.kind === "range" && <Note>Budgets are set per month, so whole months are compared: {data.months.map((m) => formatMonth(m.month)).join(", ")}.</Note>}
      <FigureGrid>
        <Figure label="Budget" value={money(totals.budget, currency)} />
        <Figure label="Actual spending" value={money(totals.spent, currency)} hint="In budgeted categories" />
        <Figure label={overspent ? "Over budget by" : "Remaining"} value={money(overspent ? totals.remaining.slice(1) : totals.remaining, currency)} tone={overspent ? "negative" : "positive"} />
        <Figure
          label="Used"
          value={pct(totals.percent_used)}
          tone={overspent ? "negative" : "default"}
          hint={totals.unbudgeted_spent !== null && !isZero(totals.unbudgeted_spent) ? `Plus ${money(totals.unbudgeted_spent, currency)} in categories without a budget.` : undefined}
        />
      </FigureGrid>
      <LazyChart title="Budget vs actual" description={data.period.label} empty={false}>
        <BudgetActualChart data={data.categories.map((c) => ({ category: c.category, budget: toNumber(c.budget), spent: toNumber(c.spent) }))} currency={currency} />
      </LazyChart>
      <Section title="By category" description={multiMonth ? "Only months where the category had a budget are counted." : undefined}>
        <DataTable
          caption="Budget by category"
          rows={data.categories}
          rowKey={(c) => c.category_id}
          columns={[
            { header: "Category", cell: (c) => c.category },
            { header: "Budget", align: "right", cell: (c) => money(c.budget, currency) },
            { header: "Spent", align: "right", cell: (c) => money(c.spent, currency) },
            { header: "Remaining", align: "right", cell: (c) => <span className={isNegative(c.remaining) ? "text-destructive" : undefined}>{money(c.remaining, currency)}</span> },
            {
              header: "Used",
              align: "right",
              cell: (c) => (
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="hidden w-16 sm:block"><Progress value={toNumber(c.percent_used)} label={`${c.category} budget used`} tone={isNegative(c.remaining) ? "destructive" : "default"} /></span>
                  <span className={isNegative(c.remaining) ? "text-destructive" : undefined}>{pct(c.percent_used)}</span>
                </span>
              ),
            },
            ...(multiMonth ? [{ header: "Months over", align: "right" as const, cell: (c: BudgetReport["categories"][number]) => `${c.months_over} of ${c.months_budgeted}` }] : []),
          ]}
          footer={["Total", money(totals.budget, currency), money(totals.spent, currency), money(totals.remaining, currency), pct(totals.percent_used), ...(multiMonth ? [""] : [])]}
        />
      </Section>
      {multiMonth && (
        <Section title="By month">
          <DataTable
            caption="Budget by month"
            rows={data.months}
            rowKey={(m) => m.month}
            columns={[
              { header: "Month", cell: (m) => formatMonth(m.month) },
              { header: "Budget", align: "right", cell: (m) => money(m.budget, currency) },
              { header: "Spent", align: "right", cell: (m) => money(m.spent, currency) },
              { header: "Remaining", align: "right", cell: (m) => money(m.remaining, currency) },
              { header: "Used", align: "right", cell: (m) => pct(m.percent_used) },
              { header: "Over budget", align: "right", cell: (m) => (m.budgeted_categories ? `${m.over_budget} of ${m.budgeted_categories}` : "No budgets") },
            ]}
          />
        </Section>
      )}
    </div>
  );
}

// --- Savings ------------------------------------------------------------------------------------------------------------

export function SavingsSection({ data }: { data: SavingsReport }) {
  const { totals, currency } = data;
  if (data.goals.length === 0) {
    return (
      <Section title="No savings goals yet" description="Create a savings goal and add money to it to see your savings here.">
        <Button asChild>
          <Link to="/savings">Create a goal</Link>
        </Button>
      </Section>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4">
      <FigureGrid>
        <Figure label="Saved in this period" value={money(totals.net, currency)} tone={isNegative(totals.net) ? "negative" : "default"} hint={`Deposits ${money(totals.deposits, currency)} · withdrawals ${money(totals.withdrawals, currency)}`} />
        <Figure label="Total saved now" value={money(totals.total_saved, currency)} hint={`Across ${totals.goals} goal${totals.goals === 1 ? "" : "s"}`} />
        <Figure label="Overall progress" value={pct(totals.progress_percent)} hint={`Of ${money(totals.total_target, currency)} in targets`} />
        <Figure label="Goals reached" value={`${totals.completed_goals} of ${totals.goals}`} />
      </FigureGrid>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LazyChart title="Savings trend" description={`Total saved at the end of each month · ${trendLabel(data.period)}`} empty={false}>
          <TrendLineChart data={data.months.map((m) => ({ month: m.month, amount: m.total_saved === null ? null : toNumber(m.total_saved) }))} currency={currency} label="Total saved" color="var(--chart-2)" />
        </LazyChart>
        <LazyChart title="Monthly savings" description="Deposits minus withdrawals" empty={data.months.every((m) => isZero(m.net))} emptyDescription="No money was added or withdrawn in these months.">
          <MonthlyTotalsChart data={data.months.map((m) => ({ month: m.month, amount: toNumber(m.net) }))} currency={currency} label="Saved" color="var(--chart-2)" />
        </LazyChart>
      </div>
      <Section title="Goal progress">
        <DataTable
          caption="Savings goals"
          rows={data.goals}
          rowKey={(g) => g.id}
          columns={[
            { header: "Goal", cell: (g) => g.name },
            { header: "Saved", align: "right", cell: (g) => money(g.current_amount, currency) },
            { header: "Target", align: "right", cell: (g) => money(g.target_amount, currency) },
            {
              header: "Progress",
              align: "right",
              cell: (g) => (
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="hidden w-16 sm:block"><Progress value={toNumber(g.progress_percent)} label={`${g.name} progress`} tone={g.completed ? "success" : "default"} /></span>
                  {g.completed ? <Badge variant="success">Reached</Badge> : pct(g.progress_percent)}
                </span>
              ),
            },
            { header: "This period", align: "right", cell: (g) => money(g.saved_in_period, currency) },
            { header: "Target date", align: "right", cell: (g) => (g.target_date ? shortDate(g.target_date) : "—") },
            { header: "Needed / month", align: "right", cell: (g) => (g.monthly_needed ? money(g.monthly_needed, currency) : "—") },
          ]}
        />
      </Section>
      <Section title="Month by month">
        <DataTable
          caption="Monthly savings"
          rows={data.months}
          rowKey={(m) => m.month}
          columns={[
            { header: "Month", cell: (m) => formatMonth(m.month) },
            { header: "Deposits", align: "right", cell: (m) => money(m.deposits, currency) },
            { header: "Withdrawals", align: "right", cell: (m) => money(m.withdrawals, currency) },
            { header: "Net", align: "right", cell: (m) => money(m.net, currency) },
            { header: "Total saved", align: "right", cell: (m) => (m.total_saved === null ? "—" : money(m.total_saved, currency)) },
          ]}
        />
      </Section>
      <Note>Starting balances entered when a goal is created count as a deposit on that day.</Note>
    </div>
  );
}

// --- Bills ---------------------------------------------------------------------------------------------------------------

const billCategory = (c: string) => BILL_CATEGORIES[c as BillCategory]?.label ?? c;
const frequency = (f: string) => BILL_FREQUENCIES[f as BillFrequency] ?? f;

function BillList({ items, currency, caption, empty, overdue }: { items: BillBrief[]; currency: string; caption: string; empty: string; overdue?: boolean }) {
  return (
    <DataTable
      caption={caption}
      rows={items}
      rowKey={(b) => b.id}
      empty={empty}
      columns={[
        { header: "Bill", cell: (b) => b.name },
        { header: "Category", cell: (b) => billCategory(b.category) },
        { header: "Due", cell: (b) => <span className={overdue ? "text-destructive" : undefined}>{shortDate(b.due_date)}{overdue ? ` (${-b.days_until_due} days ago)` : ""}</span> },
        { header: "Amount", align: "right", cell: (b) => money(b.amount, currency) },
      ]}
    />
  );
}

export function BillsSection({ data }: { data: BillsReport }) {
  const { currency } = data;
  return (
    <div className="grid grid-cols-1 gap-4">
      <FigureGrid>
        <Figure label="Paid" value={money(data.paid.total, currency)} hint={`${data.paid.count} payment${data.paid.count === 1 ? "" : "s"} in this period`} />
        <Figure label="Pending" value={money(data.pending.total, currency)} hint={`${data.pending.count} unpaid, due in this period`} />
        <Figure label="Overdue" value={money(data.overdue.total, currency)} tone={data.overdue.count ? "negative" : "default"} hint={`${data.overdue.count} bill${data.overdue.count === 1 ? "" : "s"}, as of ${shortDate(data.today)}`} />
        <Figure label="Recurring bills" value={money(data.recurring.monthly_average, currency)} hint={`Monthly average · ${money(data.recurring.yearly_total, currency)} a year`} />
      </FigureGrid>
      <LazyChart title="Paid per month" description={trendLabel(data.period)} empty={data.monthly_paid.every((m) => isZero(m.amount))} emptyDescription="No bill payments in these months.">
        <MonthlyTotalsChart data={data.monthly_paid.map((m) => ({ month: m.month, amount: toNumber(m.amount) }))} currency={currency} label="Paid" color="var(--chart-3)" />
      </LazyChart>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Overdue" description="Unpaid bills past their due date, as of today.">
          <BillList items={data.overdue.items} currency={currency} caption="Overdue bills" empty="Nothing overdue." overdue />
        </Section>
        <Section title="Pending" description="Unpaid bills whose current due date is in this period.">
          <BillList items={data.pending.items} currency={currency} caption="Pending bills" empty="No unpaid bills due in this period." />
        </Section>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Paid in this period">
          <DataTable
            caption="Bill payments by bill"
            rows={data.paid.by_bill}
            rowKey={(b) => b.bill_id}
            empty="No bills paid in this period."
            columns={[
              { header: "Bill", cell: (b) => b.name },
              { header: "Category", cell: (b) => billCategory(b.category) },
              { header: "Payments", align: "right", cell: (b) => b.count },
              { header: "Total", align: "right", cell: (b) => money(b.total, currency) },
            ]}
            footer={data.paid.count ? ["Total", "", String(data.paid.count), money(data.paid.total, currency)] : undefined}
          />
        </Section>
        <Section title="Recurring total" description="Your active recurring bills. The monthly average is the yearly total ÷ 12 (weekly bills count 52 times a year).">
          <DataTable
            caption="Recurring bills by frequency"
            rows={data.recurring.by_frequency}
            rowKey={(f) => f.frequency}
            empty="No recurring bills."
            columns={[
              { header: "Frequency", cell: (f) => frequency(f.frequency) },
              { header: "Bills", align: "right", cell: (f) => f.count },
              { header: "Per cycle", align: "right", cell: (f) => money(f.per_cycle, currency) },
              { header: "Per year", align: "right", cell: (f) => money(f.per_year, currency) },
            ]}
            footer={data.recurring.count ? ["Total", String(data.recurring.count), "", money(data.recurring.yearly_total, currency)] : undefined}
          />
        </Section>
      </div>
    </div>
  );
}
