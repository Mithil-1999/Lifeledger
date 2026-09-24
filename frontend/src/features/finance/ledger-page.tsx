import * as React from "react";
import { useSearchParams } from "react-router";
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, FolderCog, Hash, Plus, RefreshCw, SearchX } from "lucide-react";
import { toast } from "sonner";
import { ChartCard } from "@/components/charts/chart-card";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/features/dashboard/stat-card";
import { getErrorMessage } from "@/lib/api";
import { formatAmount, formatMoney, formatMonth } from "@/lib/format";
import { useCategories, useDeleteRecord, useLedgerList, useLedgerSummary, type LedgerQuery, type LedgerRecord, type SortOption } from "./api";
import { CategoryManagerDialog } from "./category-manager-dialog";
import { LEDGER_CONFIG } from "./constants";
import { EntryFormDialog } from "./entry-form-dialog";
import { EMPTY_FILTERS, type FilterState } from "./filters";
import { LedgerFilters } from "./ledger-filters";
import { LedgerTable } from "./ledger-table";

const MonthlyTotalsChart = React.lazy(() =>
  import("@/components/charts/monthly-totals-chart").then((m) => ({ default: m.MonthlyTotalsChart })),
);

const PAGE_SIZE = 20;
const SORTS: SortOption[] = ["date_desc", "date_asc", "amount_desc", "amount_asc"];

function monthRange(month: string) {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { date_from: `${month}-01`, date_to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Filters live in the URL, so they survive reloads and work with the back button. */
function useFilterParams() {
  const [params, setParams] = useSearchParams();
  const sort = params.get("sort") as SortOption | null;
  const filters: FilterState = {
    search: params.get("q") ?? "",
    category_id: params.get("category") ?? "",
    payment_method: params.get("method") ?? "",
    month: /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month")! : "",
    is_recurring: ["true", "false"].includes(params.get("recurring") ?? "") ? params.get("recurring")! : "",
    sort: sort && SORTS.includes(sort) ? sort : "date_desc",
  };
  const page = Math.max(1, Number(params.get("page")) || 1);

  const update = (next: Partial<FilterState> & { page?: number }) => {
    const merged = { ...filters, ...next };
    const out = new URLSearchParams();
    const set = (key: string, value: string) => value && out.set(key, value);
    set("q", merged.search);
    set("category", merged.category_id);
    set("method", merged.payment_method);
    set("month", merged.month);
    set("recurring", merged.is_recurring);
    if (merged.sort !== "date_desc") out.set("sort", merged.sort);
    // Changing any filter goes back to page 1.
    const nextPage = next.page ?? 1;
    if (nextPage > 1) out.set("page", String(nextPage));
    setParams(out, { replace: true });
  };

  return { filters, page, update, params, setParams };
}

export function LedgerPage({ kind }: { kind: "income" | "expense" }) {
  const config = LEDGER_CONFIG[kind];
  const { filters, page, update, params, setParams } = useFilterParams();
  const [year, setYear] = React.useState(() => new Date().getFullYear());
  // Quick actions link here with ?new=1 to open the form straight away.
  const [formOpen, setFormOpen] = React.useState(() => params.get("new") === "1");
  const [editing, setEditing] = React.useState<LedgerRecord | null>(null);
  const [deleting, setDeleting] = React.useState<LedgerRecord | null>(null);
  const [managingCategories, setManagingCategories] = React.useState(false);

  const { data: categories } = useCategories(kind);
  const query: LedgerQuery = {
    search: filters.search || undefined,
    category_id: filters.category_id || undefined,
    payment_method: filters.payment_method || undefined,
    is_recurring: filters.is_recurring || undefined,
    ...(filters.month ? monthRange(filters.month) : {}),
    sort: filters.sort,
    page,
    page_size: PAGE_SIZE,
  };
  const list = useLedgerList(kind, query);
  const summary = useLedgerSummary(kind, year);
  const remove = useDeleteRecord(kind);

  // Drop ?new=1 from the URL once handled, so a reload doesn't reopen the form.
  React.useEffect(() => {
    if (params.get("new") === "1") {
      const next = new URLSearchParams(params);
      next.delete("new");
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (record: LedgerRecord) => {
    setEditing(record);
    setFormOpen(true);
  };

  const data = list.data;
  const hasFilters = JSON.stringify({ ...filters, sort: "date_desc" }) !== JSON.stringify(EMPTY_FILTERS);
  const totalPages = data ? Math.max(1, Math.ceil(data.total_count / data.page_size)) : 1;
  const currency = summary.data?.currency ?? data?.currency ?? "NPR";
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title={config.title}
        description={config.kind === "income" ? "Money coming in, by month and category." : "Where your money goes, by month and category."}
        actions={
          <>
            {kind === "expense" && (
              <Button variant="outline" onClick={() => setManagingCategories(true)}>
                <FolderCog aria-hidden /> Categories
              </Button>
            )}
            <Button onClick={openCreate}>
              <Plus aria-hidden /> Add {config.noun}
            </Button>
          </>
        }
      />

      {/* Totals */}
      <section aria-labelledby={`${kind}-totals-heading`} className="grid grid-cols-1 gap-3">
        <h2 id={`${kind}-totals-heading`} className="sr-only">
          Totals
        </h2>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
          <StatCard
            label={`This month${summary.data ? ` (${formatMonth(summary.data.current_month)})` : ""}`}
            icon={config.icon}
            tone={config.tone}
            loading={summary.isPending}
            value={summary.data ? { amount: summary.data.current_month_total, currency } : null}
          />
          <StatCard
            label={`Total in ${year}`}
            icon={CalendarDays}
            loading={summary.isPending}
            value={summary.data ? { amount: summary.data.year_total, currency } : null}
          />
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-muted-foreground">Records in {year}</span>
              <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Hash className="size-4" aria-hidden />
              </span>
            </div>
            {summary.isPending ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <p className="text-xl font-semibold tabular-nums sm:text-2xl">{summary.data?.year_count ?? "—"}</p>
            )}
          </Card>
        </div>
      </section>

      {/* Monthly totals for the selected year */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard
            title="Monthly totals"
            description={`${config.title} per month in ${year}`}
            state={summary.isPending ? "loading" : summary.data && summary.data.year_count > 0 ? "ready" : "empty"}
            emptyTitle={`No ${config.noun} recorded in ${year}`}
            emptyDescription={`Add ${config.noun} records to see monthly totals.`}
          >
            <React.Suspense fallback={<Skeleton className="h-60 w-full" />}>
              <MonthlyTotalsChart
                label={config.title}
                currency={currency}
                color={kind === "income" ? "var(--chart-2)" : "var(--chart-4)"}
                data={(summary.data?.months ?? []).map((m) => ({ month: m.month, amount: Number(m.total) }))}
              />
            </React.Suspense>
          </ChartCard>
        </div>
        <Card className="flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">By category</h2>
            <NativeSelect aria-label="Year" className="h-8 w-24 text-xs" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </NativeSelect>
          </div>
          {summary.isPending ? (
            <div className="grid gap-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : summary.data && summary.data.by_category.length > 0 ? (
            <ul className="grid gap-2.5">
              {summary.data.by_category.slice(0, 8).map((c) => {
                const share = Number(summary.data.year_total) > 0 ? (Number(c.total) / Number(summary.data.year_total)) * 100 : 0;
                return (
                  <li key={c.category_id} className="grid gap-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{c.category}</span>
                      <span className="shrink-0 font-medium tabular-nums">{formatAmount(c.total, currency)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted" aria-hidden>
                      <div
                        className="h-1.5 rounded-full"
                        style={{ width: `${Math.max(share, 2)}%`, background: kind === "income" ? "var(--chart-2)" : "var(--chart-4)" }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">Nothing recorded in {year}.</p>
          )}
        </Card>
      </div>

      {/* Records */}
      <section aria-labelledby={`${kind}-records-heading`} className="grid grid-cols-1 gap-3">
        <h2 id={`${kind}-records-heading`} className="text-sm font-semibold text-muted-foreground">
          Records
        </h2>
        <LedgerFilters kind={kind} value={filters} onChange={(next) => update(next)} onReset={() => update(EMPTY_FILTERS)} categories={categories} />

        {list.isError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
              <span>Couldn't load records. {getErrorMessage(list.error)}</span>
              <Button size="sm" variant="outline" onClick={() => list.refetch()}>
                <RefreshCw aria-hidden /> Retry
              </Button>
            </div>
          </Alert>
        ) : list.isPending ? (
          <div className="grid gap-2" aria-label="Loading records">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : data && data.total_count === 0 ? (
          hasFilters ? (
            <EmptyState icon={SearchX} title="No matching records" description="Try a different search or clear the filters.">
              <Button variant="outline" onClick={() => update(EMPTY_FILTERS)}>
                Clear filters
              </Button>
            </EmptyState>
          ) : (
            <EmptyState icon={config.icon} title={config.emptyTitle} description={config.emptyDescription}>
              <Button onClick={openCreate}>
                <Plus aria-hidden /> Add {config.noun}
              </Button>
            </EmptyState>
          )
        ) : data ? (
          <>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {data.total_count} {data.total_count === 1 ? "record" : "records"} · Total{" "}
              <span className="font-semibold text-foreground">{formatMoney({ amount: data.total_amount, currency: data.currency })}</span>
            </p>
            <div className={list.isFetching ? "opacity-70 transition-opacity" : undefined}>
              <LedgerTable config={config} records={data.items} onEdit={openEdit} onDelete={setDeleting} />
            </div>
            {totalPages > 1 && (
              <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update({ ...filters, page: page - 1 })}>
                    <ChevronLeft aria-hidden /> Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => update({ ...filters, page: page + 1 })}>
                    Next <ChevronRight aria-hidden />
                  </Button>
                </div>
              </nav>
            )}
          </>
        ) : null}
      </section>

      <EntryFormDialog config={config} open={formOpen} onOpenChange={setFormOpen} record={editing} />
      {kind === "expense" && <CategoryManagerDialog kind={kind} open={managingCategories} onOpenChange={setManagingCategories} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete this ${config.noun}?`}
        description={
          deleting
            ? `${formatMoney(deleting)} on ${deleting.date} will be permanently deleted. This can't be undone.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(`${config.noun.charAt(0).toUpperCase()}${config.noun.slice(1)} deleted.`);
              setDeleting(null);
            },
            onError: (error) => toast.error(getErrorMessage(error)),
          })
        }
      />
    </div>
  );
}
