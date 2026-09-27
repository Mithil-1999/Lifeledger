import * as React from "react";
import { useSearchParams } from "react-router";
import { AlertCircle, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageHeader } from "@/components/common/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ALL_SOURCES, useCalendar, useEventMutations, type CalendarItem, type CalendarSource } from "@/features/calendar/api";
import { AgendaView, DayView, MonthView, WeekView } from "@/features/calendar/calendar-views";
import { EVENT_CATEGORIES, SOURCES } from "@/features/calendar/constants";
import { PERIOD_NAME, browserToday, isIsoDate, rangeLabel, shiftAnchor, viewRange, type CalendarView } from "@/features/calendar/dates";
import { EventFormDialog } from "@/features/calendar/event-form-dialog";
import { ItemDetailsDialog } from "@/features/calendar/item-details-dialog";
import { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "agenda", label: "Agenda" },
];

const isView = (value: string | null): value is CalendarView => VIEWS.some((v) => v.value === value);

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const view: CalendarView = isView(params.get("view")) ? (params.get("view") as CalendarView) : "month";
  const dateParam = params.get("date");
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [sources, setSources] = React.useState<CalendarSource[]>(ALL_SOURCES);
  const [category, setCategory] = React.useState("");
  const [form, setForm] = React.useState<{ key: number; open: boolean; eventId: string | null; date: string }>({ key: 0, open: false, eventId: null, date: "" });
  const [details, setDetails] = React.useState<CalendarItem | null>(null);
  const [deleting, setDeleting] = React.useState<CalendarItem | null>(null);
  const { remove } = useEventMutations();

  // "Today" comes from the server (APP_TIMEZONE) once loaded; the browser's date until then.
  const [serverToday, setServerToday] = React.useState<string | null>(null);
  const today = serverToday ?? browserToday();
  const anchor = isIsoDate(dateParam) ? dateParam : today;
  const { start, end } = viewRange(view, anchor);

  const { data, isPending, isError, error, refetch, isFetching } = useCalendar({
    start,
    end,
    search: debouncedSearch || undefined,
    sources,
    category: category || undefined,
  });
  if (data && data.today !== serverToday) setServerToday(data.today);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const navigate = (next: { view?: CalendarView; date?: string }) =>
    setParams({ view: next.view ?? view, date: next.date ?? anchor }, { replace: true });

  const openCreate = (date = anchor) => setForm((f) => ({ key: f.key + 1, open: true, eventId: null, date }));
  const openEdit = (item: CalendarItem) => {
    setDetails(null);
    setForm((f) => ({ key: f.key + 1, open: true, eventId: item.source_id, date: item.date }));
  };
  const toggleSource = (source: CalendarSource) =>
    setSources((current) => (current.includes(source) ? current.filter((s) => s !== source) : ALL_SOURCES.filter((s) => s === source || current.includes(s))));

  const viewProps = { items: data?.items ?? [], start, end, today, onOpenItem: setDetails };
  const period = PERIOD_NAME[view];

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader
        title="Calendar"
        description="Your events together with tasks, reminders, bills and savings deadlines."
        actions={
          <Button onClick={() => openCreate()}>
            <Plus aria-hidden /> Add event
          </Button>
        }
      />

      {/* Toolbar: period navigation + view switcher */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="outline" size="icon" aria-label={`Previous ${period}`} onClick={() => navigate({ date: shiftAnchor(view, anchor, -1) })}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" aria-label={`Next ${period}`} onClick={() => navigate({ date: shiftAnchor(view, anchor, 1) })}>
            <ChevronRight />
          </Button>
          <Button variant="outline" onClick={() => navigate({ date: today })} disabled={anchor === today}>
            Today
          </Button>
          <h2 className="ml-1 min-w-0 truncate text-base font-semibold sm:text-lg" aria-live="polite">
            {rangeLabel(view, anchor)}
          </h2>
        </div>
        <Tabs value={view} onValueChange={(v) => navigate({ view: v as CalendarView })}>
          <TabsList aria-label="Calendar view">
            {VIEWS.map((v) => (
              <TabsTrigger key={v.value} value={v.value}>
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]" role="search" aria-label="Filter calendar">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Search calendar" placeholder="Search titles, notes, places…" className="pl-9" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <NativeSelect aria-label="Event category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All event categories</option>
          {Object.entries(EVENT_CATEGORIES).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show on calendar">
        {ALL_SOURCES.map((source) => {
          const meta = SOURCES[source];
          const on = sources.includes(source);
          const count = data?.counts[source] ?? 0;
          return (
            <button
              key={source}
              type="button"
              aria-pressed={on}
              onClick={() => toggleSource(source)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                on ? "bg-card text-foreground" : "bg-transparent text-muted-foreground line-through",
              )}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: on ? meta.color : "var(--muted-foreground)" }} aria-hidden />
              {meta.plural}
              {on && data && <span className="tabular-nums text-muted-foreground">{count}</span>}
            </button>
          );
        })}
      </div>

      {sources.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Choose at least one type to show.</p>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <span>Couldn't load the calendar. {getErrorMessage(error)}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : isPending ? (
        <Skeleton className="h-96 rounded-xl" aria-label="Loading calendar" />
      ) : (
        <div className={cn("min-w-0", isFetching && "opacity-70")} aria-busy={isFetching}>
          {debouncedSearch && (
            <p className="mb-2 text-sm text-muted-foreground" role="status">
              {data.items.length === 0 ? "No matches in this " : `${data.items.length} match${data.items.length === 1 ? "" : "es"} in this `}
              {period}.
            </p>
          )}
          {view === "month" && <MonthView {...viewProps} anchor={anchor} selected={anchor} onSelectDay={(date) => navigate({ date })} />}
          {view === "week" && <WeekView {...viewProps} onOpenDay={(date) => navigate({ view: "day", date })} />}
          {view === "day" && <DayView {...viewProps} onAdd={() => openCreate(anchor)} />}
          {view === "agenda" && <AgendaView {...viewProps} />}
        </div>
      )}

      <ItemDetailsDialog item={details} onOpenChange={(open) => !open && setDetails(null)} onEdit={openEdit} onDelete={(item) => { setDetails(null); setDeleting(item); }} />
      <EventFormDialog key={form.key} open={form.open} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} eventId={form.eventId} defaultDate={form.date || anchor} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete “${deleting?.title}”?`}
        description={
          deleting?.recurrence
            ? "This deletes every occurrence of this repeating event, and its reminder."
            : "This event and its reminder will be permanently deleted."
        }
        confirmLabel="Delete event"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.source_id, {
            onSuccess: () => {
              toast.success("Event deleted.");
              setDeleting(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
