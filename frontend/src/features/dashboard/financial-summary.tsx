import { ChartPie, Info, PiggyBank, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type { DashboardSummary } from "./api";
import { StatCard } from "./stat-card";

export function FinancialSummary({ finance, loading }: { finance?: DashboardSummary["finance"]; loading: boolean }) {
  const unavailable = finance && !finance.available;

  return (
    <section aria-labelledby="finance-heading" className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="finance-heading" className="text-sm font-semibold text-muted-foreground">
          Financial summary
        </h2>
        {unavailable && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5 shrink-0" aria-hidden />
            Figures appear once you start recording income and expenses (Phase {finance.available_from_phase}).
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Monthly income" icon={TrendingUp} tone="positive" value={finance?.monthly_income} loading={loading} />
        <StatCard label="Monthly expenses" icon={TrendingDown} tone="negative" value={finance?.monthly_expenses} loading={loading} />
        <StatCard label="Current balance" icon={Wallet} value={finance?.current_balance} loading={loading} />
        <StatCard label="Savings" icon={PiggyBank} value={finance?.savings} loading={loading} />
        <StatCard label="Budget remaining" icon={ChartPie} value={finance?.budget_remaining} loading={loading} />
      </div>
    </section>
  );
}
