import * as React from "react";
import { Link } from "react-router";
import { ArrowRight, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { ChartCard } from "@/components/charts/chart-card";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/features/dashboard/stat-card";
import { useLedgerSummary } from "@/features/finance/api";
import { formatAmount } from "@/lib/format";

const IncomeExpenseChart = React.lazy(() =>
  import("@/components/charts/income-expense-chart").then((m) => ({ default: m.IncomeExpenseChart })),
);

/** Exact subtraction of two decimal strings (cents as BigInt) for display. */
function subtractDecimal(a: string, b: string) {
  const cents = (value: string) => {
    const [whole, fraction = ""] = value.replace("-", "").split(".");
    const magnitude = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
    return value.startsWith("-") ? -magnitude : magnitude;
  };
  const diff = cents(a) - cents(b);
  const negative = diff < 0n;
  const abs = negative ? -diff : diff;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

export function FinancePage() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = React.useState(thisYear);
  const income = useLedgerSummary("income", year);
  const expenses = useLedgerSummary("expense", year);
  const loading = income.isPending || expenses.isPending;
  const currency = income.data?.currency ?? "NPR";
  const net = income.data && expenses.data ? subtractDecimal(income.data.year_total, expenses.data.year_total) : null;
  const hasData = (income.data?.year_count ?? 0) + (expenses.data?.year_count ?? 0) > 0;

  const months = (income.data?.months ?? []).map((m, i) => ({
    month: m.month,
    income: Number(m.total),
    expenses: Number(expenses.data?.months[i]?.total ?? 0),
  }));

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Finance"
        description="Your cash flow for the year: income, expenses and what's left."
        actions={
          <NativeSelect aria-label="Year" className="w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </NativeSelect>
        }
      />

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        <StatCard label={`Income in ${year}`} icon={TrendingUp} tone="positive" loading={loading} value={income.data ? { amount: income.data.year_total, currency } : null} />
        <StatCard label={`Expenses in ${year}`} icon={TrendingDown} tone="negative" loading={loading} value={expenses.data ? { amount: expenses.data.year_total, currency } : null} />
        <StatCard label="Net cash flow" icon={Scale} tone={net?.startsWith("-") ? "negative" : "positive"} loading={loading} value={net ? { amount: net, currency } : null} />
      </div>

      <ChartCard
        title="Income vs expenses"
        description={`Each month of ${year}`}
        state={loading ? "loading" : hasData ? "ready" : "empty"}
        emptyTitle={`Nothing recorded in ${year}`}
        emptyDescription="Add income and expenses to see your monthly cash flow."
      >
        <React.Suspense fallback={<Skeleton className="h-60 w-full" />}>
          <IncomeExpenseChart data={months} currency={currency} />
        </React.Suspense>
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {([
          ["Top income sources", income, "/income", "Go to income"],
          ["Top expense categories", expenses, "/expenses", "Go to expenses"],
        ] as const).map(([title, summary, href, cta]) => (
          <Card key={href} className="flex flex-col p-5">
            <h2 className="mb-3 text-base font-semibold">{title}</h2>
            {summary.isPending ? (
              <Skeleton className="h-24" />
            ) : summary.data && summary.data.by_category.length > 0 ? (
              <ul className="grid gap-2 text-sm">
                {summary.data.by_category.slice(0, 5).map((c) => (
                  <li key={c.category_id} className="flex justify-between gap-2">
                    <span className="truncate text-muted-foreground">{c.category}</span>
                    <span className="font-medium tabular-nums">{formatAmount(c.total, currency)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing recorded in {year}.</p>
            )}
            <Button variant="link" asChild className="mt-auto justify-start px-0 pt-4">
              <Link to={href}>
                {cta} <ArrowRight aria-hidden />
              </Link>
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
