/**
 * Calendar date maths on "YYYY-MM-DD" strings. Everything runs in UTC so a date never
 * shifts because of the browser's timezone or daylight-saving changes.
 */
import type { CalendarItem } from "./api";

export type CalendarView = "month" | "week" | "day" | "agenda";

export const AGENDA_DAYS = 30;
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

function toUTC(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const fromUTC = (date: Date) => date.toISOString().slice(0, 10);

export function isIsoDate(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUTC(toUTC(value)) === value;
}

export function browserToday(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const addDays = (iso: string, days: number) => fromUTC(new Date(toUTC(iso).getTime() + days * DAY_MS));

export const daysBetween = (from: string, to: string) => Math.round((toUTC(to).getTime() - toUTC(from).getTime()) / DAY_MS);

export const weekday = (iso: string) => toUTC(iso).getUTCDay();

/** Same day of the month `months` later, clamped to the month's length (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
}

export const startOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;
export const startOfWeek = (iso: string) => addDays(iso, -weekday(iso)); // weeks start on Sunday
export const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

export function eachDay(start: string, end: string) {
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

/** The dates a view shows. Month view is always 6 full weeks so the grid never jumps in height. */
export function viewRange(view: CalendarView, anchor: string) {
  switch (view) {
    case "month": {
      const start = startOfWeek(startOfMonth(anchor));
      return { start, end: addDays(start, 41) };
    }
    case "week": {
      const start = startOfWeek(anchor);
      return { start, end: addDays(start, 6) };
    }
    case "day":
      return { start: anchor, end: anchor };
    case "agenda":
      return { start: anchor, end: addDays(anchor, AGENDA_DAYS - 1) };
  }
}

export function shiftAnchor(view: CalendarView, anchor: string, direction: 1 | -1) {
  switch (view) {
    case "month":
      return addMonths(anchor, direction);
    case "week":
      return addDays(anchor, 7 * direction);
    case "day":
      return addDays(anchor, direction);
    case "agenda":
      return addDays(anchor, AGENDA_DAYS * direction);
  }
}

const fmt = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(toUTC(iso));

export const formatDay = (iso: string, options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) =>
  fmt(iso, options);

export function rangeLabel(view: CalendarView, anchor: string) {
  const { start, end } = viewRange(view, anchor);
  if (view === "month") return fmt(anchor, { month: "long", year: "numeric" });
  if (view === "day") return formatDay(anchor);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${fmt(start, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })} – ${fmt(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

export const PERIOD_NAME: Record<CalendarView, string> = { month: "month", week: "week", day: "day", agenda: `${AGENDA_DAYS} days` };

/** Items grouped by every day they cover (multi-day events appear on each day), clipped to the range. */
export function itemsByDay(items: CalendarItem[], start: string, end: string) {
  const map = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const from = item.date > start ? item.date : start;
    const to = item.end_date < end ? item.end_date : end;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const list = map.get(d);
      if (list) list.push(item);
      else map.set(d, [item]);
    }
  }
  return map;
}
