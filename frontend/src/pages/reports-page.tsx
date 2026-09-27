import { useSearchParams } from "react-router";
import { AlertCircle, Download } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCategories } from "@/features/finance/api";
import { BILL_CATEGORIES } from "@/features/planning/constants";
import { reportPath, useReport, type ReportData, type ReportKind, type ReportParams } from "@/features/reports/api";
import { BillsSection, BudgetSection, ExpensesSection, FinanceSection, SavingsSection } from "@/features/reports/report-sections";
import { ReportSkeleton } from "@/features/reports/report-ui";
import { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const TABS: { value: ReportKind; label: string }[] = [
  { value: "finance", label: "Monthly finance" },
  { value: "expenses", label: "Expenses" },
  { value: "budget", label: "Budget" },
  { value: "savings", label: "Savings" },
  { value: "bills", label: "Bills" },
];

type Mode = "month" | "year" | "range";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const isIsoDate = (v: string | null): v is string => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);

function useReportFilters() {
  const [params, setParams] = useSearchParams();
  const now = new Date();
  const thisYear = now.getFullYear();
  const defaultMonth = `${thisYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const tabParam = params.get("report");
  const tab: ReportKind = TABS.some((t) => t.value === tabParam) ? (tabParam as ReportKind) : "finance";
  const modeParam = params.get("period");
  const mode: Mode = modeParam === "year" || modeParam === "range" ? modeParam : "month";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("month") ?? "") ? params.get("month")! : defaultMonth;
  const year = /^\d{4}$/.test(params.get("year") ?? "") ? params.get("year")! : String(thisYear);
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const category = params.get("category") ?? "";
  const bill = params.get("bill") ?? "";

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  let rangeError: string | null = null;
  const period: ReportParams = {};
  if (mode === "month") period.month = month;
  else if (mode === "year") period.year = year;
  else if (!isIsoDate(from) || !isIsoDate(to)) rangeError = "Choose a start and an end date.";
  else if (to < from) rangeError = "The end date can't be before the start date.";
  else {
    period.date_from = from;
    period.date_to = to;
  }

  const query: ReportParams = { ...period };
  if ((tab === "expenses" || tab === "budget") && category) query.category_id = category;
  if (tab === "bills" && bill) query.category = bill;

  const years = Array.from({ length: 12 }, (_, i) => String(thisYear + 1 - i));
  return { tab, mode, month, year, from, to, category, bill, years, update, query, rangeError };
}

function ReportBody({ tab, query, enabled }: { tab: ReportKind; query: ReportParams; enabled: boolean }) {
  const { data, isPending, isError, error, refetch, isFetching } = useReport(tab, query, enabled);
  if (!enabled) return null;
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
          <span>Couldn't load the report. {getErrorMessage(error)}</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </Alert>
    );
  }
  if (isPending) return <ReportSkeleton />;
  return (
    <div className={cn("grid min-w-0 grid-cols-1 gap-3", isFetching && "opacity-70")} aria-busy={isFetching}>
      <h2 className="text-base font-semibold">
        {TABS.find((t) => t.value === tab)?.label} · <span className="font-normal text-muted-foreground">{data.period.label}</span>
      </h2>
      {tab === "finance" && <FinanceSection data={data as ReportData["finance"]} />}
      {tab === "expenses" && <ExpensesSection data={data as ReportData["expenses"]} />}
      {tab === "budget" && <BudgetSection data={data as ReportData["budget"]} />}
      {tab === "savings" && <SavingsSection data={data as ReportData["savings"]} />}
      {tab === "bills" && <BillsSection data={data as ReportData["bills"]} />}
    </div>
  );
}

export function ReportsPage() {
  const f = useReportFilters();
  const { data: categories } = useCategories("expense");
  const enabled = f.rangeError === null;
  const tabLabel = TABS.find((t) => t.value === f.tab)!.label;

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader
        title="Reports"
        description="Financial reports built from your recorded income, expenses, budgets, savings and bills."
        actions={
          enabled ? (
            <Button asChild variant="outline">
              <a href={reportPath(f.tab, f.query, true)} download aria-label={`Export ${tabLabel} report as CSV`}>
                <Download aria-hidden /> Export CSV
              </a>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              <Download aria-hidden /> Export CSV
            </Button>
          )
        }
      />

      <Tabs value={f.tab} onValueChange={(v) => f.update({ report: v })}>
        <div className="overflow-x-auto [scrollbar-width:none]">
          <TabsList aria-label="Reports" className="w-max sm:w-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      <div className="grid grid-cols-1 gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end" role="group" aria-label="Report filters">
        <div className="grid gap-1.5">
          <Label htmlFor="report-period">Period</Label>
          <NativeSelect id="report-period" value={f.mode} onChange={(e) => f.update({ period: e.target.value })}>
            <option value="month">Month</option>
            <option value="year">Year</option>
            <option value="range">Custom dates</option>
          </NativeSelect>
        </div>
        {f.mode === "month" && (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="report-month">Month</Label>
              <NativeSelect id="report-month" value={f.month.slice(5)} onChange={(e) => f.update({ month: `${f.month.slice(0, 4)}-${e.target.value}` })}>
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={String(i + 1).padStart(2, "0")}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="report-month-year">Year</Label>
              <NativeSelect id="report-month-year" value={f.month.slice(0, 4)} onChange={(e) => f.update({ month: `${e.target.value}-${f.month.slice(5)}` })}>
                {(f.years.includes(f.month.slice(0, 4)) ? f.years : [f.month.slice(0, 4), ...f.years]).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </>
        )}
        {f.mode === "year" && (
          <div className="grid gap-1.5">
            <Label htmlFor="report-year">Year</Label>
            <NativeSelect id="report-year" value={f.year} onChange={(e) => f.update({ year: e.target.value })}>
              {(f.years.includes(f.year) ? f.years : [f.year, ...f.years]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {f.mode === "range" && (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="report-from">From</Label>
              <Input id="report-from" type="date" value={f.from} onChange={(e) => f.update({ from: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="report-to">To</Label>
              <Input id="report-to" type="date" value={f.to} onChange={(e) => f.update({ to: e.target.value })} />
            </div>
          </>
        )}
        {(f.tab === "expenses" || f.tab === "budget") && (
          <div className="grid gap-1.5">
            <Label htmlFor="report-category">Category</Label>
            <NativeSelect id="report-category" value={f.category} onChange={(e) => f.update({ category: e.target.value })}>
              <option value="">All categories</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {f.tab === "bills" && (
          <div className="grid gap-1.5">
            <Label htmlFor="report-bill-category">Category</Label>
            <NativeSelect id="report-bill-category" value={f.bill} onChange={(e) => f.update({ bill: e.target.value })}>
              <option value="">All categories</option>
              {Object.entries(BILL_CATEGORIES).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      {f.rangeError && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground" role="status">
          {f.rangeError}
        </p>
      )}
      <ReportBody tab={f.tab} query={f.query} enabled={enabled} />
    </div>
  );
}
