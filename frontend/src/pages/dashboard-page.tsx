import * as React from "react";
import { Link } from "react-router";
import { AlertCircle, ArrowRight, RefreshCw } from "lucide-react";
import { NAV_GROUPS } from "@/config/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/features/auth/use-auth";
import { useDashboardSummary } from "@/features/dashboard/api";
import { BillsPanel } from "@/features/dashboard/bills-panel";
import { FinancialSummary } from "@/features/dashboard/financial-summary";
import { QuickActions } from "@/features/dashboard/quick-actions";
import { RemindersPanel } from "@/features/dashboard/reminders-panel";
import { TasksPanel } from "@/features/dashboard/tasks-panel";
import { SystemStatusCard } from "@/features/system/system-status-card";
import { formatDate, greeting } from "@/lib/format";
import { getErrorMessage } from "@/lib/api";

// Charts pull in Recharts; load them after the rest of the dashboard.
const DashboardCharts = React.lazy(() =>
  import("@/features/dashboard/dashboard-charts").then((m) => ({ default: m.DashboardCharts })),
);

const MODULES =NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.path !== "/dashboard");

function ChartsFallback() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-80 rounded-xl" />
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { data: user } = useCurrentUser();
  const { data: summary, isPending, isError, error, refetch, isFetching } = useDashboardSummary();
  const firstName = user?.name.split(/\s+/)[0];

  return (
    // grid-cols-1 = minmax(0, 1fr): stops wide children (e.g. the scrollable quick-action
    // strip on phones) from stretching the page wider than the screen.
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Dashboard"
        description={
          summary
            ? `${greeting()}${firstName ? `, ${firstName}` : ""}. Here's ${summary.period.label} at a glance, as of ${formatDate(summary.period.today)}.`
            : `${greeting()}${firstName ? `, ${firstName}` : ""}.`
        }
      />

      <QuickActions />

      {isError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <span>Couldn't load your dashboard. {getErrorMessage(error)}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={isFetching ? "animate-spin" : undefined} aria-hidden /> Retry
            </Button>
          </div>
        </Alert>
      )}

      <FinancialSummary finance={summary?.finance} loading={isPending} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TasksPanel tasks={summary?.tasks} loading={isPending} />
        <BillsPanel bills={summary?.bills} loading={isPending} />
        <RemindersPanel reminders={summary?.reminders} loading={isPending} />
      </div>

      <React.Suspense fallback={<ChartsFallback />}>
        <DashboardCharts summary={summary} loading={isPending} />
      </React.Suspense>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section aria-labelledby="modules-heading" className="lg:col-span-2">
          <h2 id="modules-heading" className="mb-3 text-sm font-semibold text-muted-foreground">
            All modules
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {MODULES.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className="group flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                  <span className="text-[11px] text-muted-foreground">Phase {item.phase}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              );
            })}
          </div>
        </section>
        <div className="lg:pt-8">
          <SystemStatusCard />
        </div>
      </div>
    </div>
  );
}
