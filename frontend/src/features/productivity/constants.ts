import type { IntervalUnit, ReminderRepeat, TaskPriority, TaskRecurrence, TaskStatus } from "./api";

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive";

export const TASK_STATUS: Record<TaskStatus, { label: string; variant: BadgeVariant }> = {
  not_started: { label: "Not started", variant: "outline" },
  in_progress: { label: "In progress", variant: "default" },
  completed: { label: "Completed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export const TASK_PRIORITY: Record<TaskPriority, { label: string; variant: BadgeVariant }> = {
  low: { label: "Low", variant: "secondary" },
  medium: { label: "Medium", variant: "outline" },
  high: { label: "High", variant: "warning" },
  urgent: { label: "Urgent", variant: "destructive" },
};

export const TASK_RECURRENCE: Record<TaskRecurrence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export const CATEGORY_SUGGESTIONS = ["Personal", "Work", "Study", "Home", "Health", "Finance", "Errands", "Family"];

export const REMINDER_REPEAT: Record<ReminderRepeat, string> = {
  none: "One-time",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
  custom: "Custom",
};

export const INTERVAL_UNITS: Record<IntervalUnit, string> = { days: "days", weeks: "weeks", months: "months", years: "years" };

export function repeatLabel(repeat: ReminderRepeat, count: number | null, unit: IntervalUnit | null) {
  if (repeat === "custom" && count && unit) {
    return count === 1 ? `Every ${unit.slice(0, -1)}` : `Every ${count} ${unit}`;
  }
  return REMINDER_REPEAT[repeat];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO timestamp -> value for <input type="date"> and <input type="time"> in the browser's timezone. */
export function toLocalParts(iso: string) {
  const d = new Date(iso);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** Local date + time inputs -> ISO string with the correct UTC offset. */
export function fromLocalParts(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

const dateTime = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function formatDateTime(iso: string) {
  return dateTime.format(new Date(iso));
}

/** "in 3 hours", "5 min ago" for reminder times. */
export function relativeTime(iso: string, now = Date.now()) {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") return rtf.format(Math.round(diff / ms), unit);
  }
  return "";
}

/** "HH:MM:SS" -> "HH:MM" */
export const shortTime = (time: string | null) => (time ? time.slice(0, 5) : null);

/** Tomorrow at 09:00 in the browser's timezone, as ISO. */
export function tomorrowMorningIso(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}
