import { createElement } from "react";
import { CalendarPlus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CalendarItem } from "./api";
import { itemColor, itemIcon, itemTypeLabel, statusLabel, timeLabel } from "./constants";
import { WEEKDAYS, eachDay, formatDay, itemsByDay, sameMonth, weekday } from "./dates";

interface ViewProps {
  items: CalendarItem[];
  start: string;
  end: string;
  today: string;
  onOpenItem: (item: CalendarItem) => void;
}

const MAX_CHIPS = 3;

function itemAriaLabel(item: CalendarItem) {
  const parts = [itemTypeLabel(item), item.title, timeLabel(item)];
  if (item.is_overdue) parts.push(item.source === "reminder" ? "due" : "overdue");
  else if (item.is_done) parts.push(statusLabel(item.status) ?? "done");
  return parts.join(", ");
}

/** Compact one-line entry used in the month grid. */
function ItemChip({ item, onOpen }: { item: CalendarItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={itemAriaLabel(item)}
      className={cn(
        "flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight hover:bg-accent",
        item.is_done && "text-muted-foreground line-through",
        item.is_overdue && "text-destructive",
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: itemColor(item) }} aria-hidden />
      {!item.all_day && item.start_time && <span className="shrink-0 tabular-nums text-muted-foreground">{item.start_time.slice(0, 5)}</span>}
      <span className="truncate">{item.title}</span>
    </button>
  );
}

/** Full row used in the week, day and agenda views. */
export function ItemRow({ item, day, onOpen }: { item: CalendarItem; day: string; onOpen: () => void }) {
  const continued = day > item.date;
  const time = continued ? "Continues" : timeLabel(item);
  const status = item.is_overdue ? (item.source === "reminder" ? "Due" : "Overdue") : item.is_done ? statusLabel(item.status) : null;
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={itemAriaLabel(item)}
        className={cn(
          "flex w-full min-w-0 items-start gap-2.5 rounded-lg border border-l-4 bg-card px-2.5 py-2 text-left hover:bg-accent/40",
          item.is_overdue && "border-destructive/40",
        )}
        style={{ borderLeftColor: itemColor(item) }}
      >
        {createElement(itemIcon(item), { className: "mt-0.5 size-4 shrink-0 text-muted-foreground", "aria-hidden": true })}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm font-medium", item.is_done && "text-muted-foreground line-through")}>{item.title}</span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span className="tabular-nums">{time}</span>
            <span aria-hidden>·</span>
            <span>{itemTypeLabel(item)}</span>
            {item.amount && item.currency && item.source === "bill" && (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{formatAmount(item.amount, item.currency)}</span>
              </>
            )}
            {item.location && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{item.location}</span>
              </>
            )}
            {item.recurrence && <Repeat className="size-3" aria-label="Repeats" />}
            {status && <span className={cn("font-medium", item.is_overdue ? "text-destructive" : "text-success")}>{status}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

function DayItems({ day, items, onOpenItem, emptyText = "Nothing planned." }: { day: string; items: CalendarItem[]; onOpenItem: (i: CalendarItem) => void; emptyText?: string }) {
  if (items.length === 0) return <p className="px-1 py-2 text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="grid gap-1.5">
      {items.map((item) => (
        <ItemRow key={item.key} item={item} day={day} onOpen={() => onOpenItem(item)} />
      ))}
    </ul>
  );
}

// --- Month -----------------------------------------------------------------------------------------------------

export function MonthView({ items, start, end, today, anchor, selected, onSelectDay, onOpenItem }: ViewProps & { anchor: string; selected: string; onSelectDay: (day: string) => void }) {
  const byDay = itemsByDay(items, start, end);
  const days = eachDay(start, end);
  const selectedItems = byDay.get(selected) ?? [];
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground" aria-hidden>
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>
        <ol className="grid grid-cols-7" aria-label="Days of the month">
          {days.map((day) => {
            const dayItems = byDay.get(day) ?? [];
            const outside = !sameMonth(day, anchor);
            const isToday = day === today;
            const isSelected = day === selected;
            const label = `${formatDay(day)}${isToday ? ", today" : ""}: ${dayItems.length === 0 ? "nothing planned" : `${dayItems.length} item${dayItems.length === 1 ? "" : "s"}`}`;
            return (
              <li
                key={day}
                className={cn(
                  "min-h-14 min-w-0 border-b border-r p-0.5 sm:min-h-28 sm:p-1 [&:nth-child(7n)]:border-r-0",
                  outside && "bg-muted/30",
                  isSelected && "bg-accent/50",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-label={label}
                  aria-pressed={isSelected}
                  className="flex w-full flex-col items-center gap-1 rounded-md py-0.5 sm:items-start sm:px-1"
                >
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                      outside && "text-muted-foreground",
                      isToday && "bg-primary font-semibold text-primary-foreground",
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>
                  {/* Phones: coloured dots only; the selected day's list is shown below the grid. */}
                  {dayItems.length > 0 && (
                    <span className="flex gap-0.5 sm:hidden" aria-hidden>
                      {dayItems.slice(0, MAX_CHIPS).map((item) => (
                        <span key={item.key} className="size-1.5 rounded-full" style={{ backgroundColor: itemColor(item) }} />
                      ))}
                    </span>
                  )}
                </button>
                <div className="hidden min-w-0 sm:grid">
                  {dayItems.slice(0, MAX_CHIPS).map((item) => (
                    <ItemChip key={item.key} item={item} onOpen={() => onOpenItem(item)} />
                  ))}
                  {dayItems.length > MAX_CHIPS && (
                    <button type="button" onClick={() => onSelectDay(day)} className="px-1 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground">
                      +{dayItems.length - MAX_CHIPS} more
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <section aria-labelledby="selected-day-heading" className="grid gap-2">
        <h2 id="selected-day-heading" className="text-sm font-semibold">
          {formatDay(selected)}
          {selected === today && <span className="font-normal text-muted-foreground"> · Today</span>}
        </h2>
        <DayItems day={selected} items={selectedItems} onOpenItem={onOpenItem} />
      </section>
    </div>
  );
}

// --- Week ---------------------------------------------------------------------------------------------------------

export function WeekView({ items, start, end, today, onOpenItem, onOpenDay }: ViewProps & { onOpenDay: (day: string) => void }) {
  const byDay = itemsByDay(items, start, end);
  return (
    <ol className="grid grid-cols-1 gap-2 lg:grid-cols-7" aria-label="Days of the week">
      {eachDay(start, end).map((day) => {
        const isToday = day === today;
        return (
          <li key={day} className={cn("min-w-0 rounded-xl border bg-card p-2", isToday && "border-primary/60 ring-1 ring-primary/30")}>
            <button
              type="button"
              onClick={() => onOpenDay(day)}
              className="mb-2 flex w-full items-baseline gap-1.5 rounded-md px-1 text-left hover:text-primary lg:flex-col lg:items-start lg:gap-0"
              aria-label={`Open ${formatDay(day)}${isToday ? ", today" : ""}`}
            >
              <span className="text-xs font-medium uppercase text-muted-foreground">{WEEKDAYS[weekday(day)]}</span>
              <span className={cn("text-lg font-semibold tabular-nums", isToday && "text-primary")}>{Number(day.slice(8))}</span>
              <span className="text-xs text-muted-foreground lg:hidden">{formatDay(day, { month: "short" })}</span>
            </button>
            <DayItems day={day} items={byDay.get(day) ?? []} onOpenItem={onOpenItem} emptyText="—" />
          </li>
        );
      })}
    </ol>
  );
}

// --- Day ------------------------------------------------------------------------------------------------------------

export function DayView({ items, start, end, today, onOpenItem, onAdd }: ViewProps & { onAdd: () => void }) {
  const dayItems = itemsByDay(items, start, end).get(start) ?? [];
  const allDay = dayItems.filter((i) => i.all_day || start > i.date);
  const timed = dayItems.filter((i) => !allDay.includes(i));
  return (
    <div className="grid grid-cols-1 gap-4 rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {formatDay(start)}
          {start === today && <span className="font-normal text-muted-foreground"> · Today</span>}
        </h2>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <CalendarPlus aria-hidden /> Add event this day
        </Button>
      </div>
      {dayItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing planned for this day.</p>
      ) : (
        <>
          {allDay.length > 0 && (
            <section aria-labelledby="day-all-day" className="grid gap-2">
              <h3 id="day-all-day" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                All day
              </h3>
              <DayItems day={start} items={allDay} onOpenItem={onOpenItem} />
            </section>
          )}
          {timed.length > 0 && (
            <section aria-labelledby="day-timed" className="grid gap-2">
              <h3 id="day-timed" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Schedule
              </h3>
              <DayItems day={start} items={timed} onOpenItem={onOpenItem} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

// --- Agenda ---------------------------------------------------------------------------------------------------------

export function AgendaView({ items, start, end, today, onOpenItem }: ViewProps) {
  const byDay = itemsByDay(items, start, end);
  const days = eachDay(start, end).filter((d) => byDay.has(d));
  if (days.length === 0) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing scheduled in this period.</p>;
  return (
    <ol className="grid grid-cols-1 gap-4" aria-label="Agenda">
      {days.map((day) => (
        <li key={day} className="grid min-w-0 gap-2 sm:grid-cols-[10rem_1fr]">
          <h2 className={cn("text-sm font-semibold sm:pt-2", day === today && "text-primary")}>
            {formatDay(day, { weekday: "short", day: "numeric", month: "short" })}
            {day === today && <span className="font-normal"> · Today</span>}
          </h2>
          <DayItems day={day} items={byDay.get(day) ?? []} onOpenItem={onOpenItem} />
        </li>
      ))}
    </ol>
  );
}
