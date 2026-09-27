import { BellRing, CalendarDays, Flag, ListChecks, PiggyBank, ReceiptText, Stethoscope, User, type LucideIcon } from "lucide-react";
import type { CalendarItem, CalendarSource, EventCategory, EventRecurrence, EventType } from "./api";

export const SOURCES: Record<CalendarSource, { label: string; plural: string; icon: LucideIcon; color: string; path: string | null; module: string }> = {
  event: { label: "Event", plural: "Events", icon: CalendarDays, color: "var(--primary)", path: null, module: "Calendar" },
  task: { label: "Task", plural: "Tasks", icon: ListChecks, color: "var(--chart-1)", path: "/tasks", module: "Tasks" },
  reminder: { label: "Reminder", plural: "Reminders", icon: BellRing, color: "var(--chart-5)", path: "/reminders", module: "Reminders" },
  bill: { label: "Bill", plural: "Bills", icon: ReceiptText, color: "var(--chart-3)", path: "/bills", module: "Bills" },
  goal: { label: "Savings deadline", plural: "Goal deadlines", icon: PiggyBank, color: "var(--chart-2)", path: "/savings", module: "Savings" },
};

export const EVENT_TYPES: Record<EventType, { label: string; icon: LucideIcon }> = {
  appointment: { label: "Appointment", icon: Stethoscope },
  personal: { label: "Personal event", icon: User },
  deadline: { label: "Deadline", icon: Flag },
};

/** Category colours (the same hue family as the charts, so they work in light and dark mode). */
export const EVENT_CATEGORIES: Record<EventCategory, { label: string; color: string }> = {
  personal: { label: "Personal", color: "var(--primary)" },
  work: { label: "Work", color: "var(--chart-5)" },
  health: { label: "Health", color: "var(--chart-4)" },
  family: { label: "Family", color: "var(--chart-2)" },
  finance: { label: "Finance", color: "var(--chart-3)" },
  education: { label: "Education", color: "var(--chart-1)" },
  social: { label: "Social", color: "oklch(0.65 0.18 330)" },
  travel: { label: "Travel", color: "oklch(0.62 0.12 200)" },
  other: { label: "Other", color: "var(--muted-foreground)" },
};

export const EVENT_RECURRENCE: Record<EventRecurrence, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

export const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "At the start time" },
  { value: 5, label: "5 minutes before" },
  { value: 10, label: "10 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 1440, label: "1 day before" },
  { value: 2880, label: "2 days before" },
  { value: 10080, label: "1 week before" },
];

export function reminderLabel(minutes: number | null) {
  return REMINDER_OPTIONS.find((o) => o.value === minutes)?.label ?? null;
}

export function itemColor(item: CalendarItem) {
  if (item.source === "event") return EVENT_CATEGORIES[item.category as EventCategory]?.color ?? SOURCES.event.color;
  return SOURCES[item.source].color;
}

export function itemIcon(item: CalendarItem): LucideIcon {
  if (item.source === "event") return EVENT_TYPES[item.kind as EventType]?.icon ?? CalendarDays;
  return SOURCES[item.source].icon;
}

/** Short label for the item's type, e.g. "Appointment", "Task", "Bill". */
export function itemTypeLabel(item: CalendarItem) {
  if (item.source === "event") return EVENT_TYPES[item.kind as EventType]?.label ?? "Event";
  return SOURCES[item.source].label;
}

const STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  due: "Due",
  snoozed: "Snoozed",
  scheduled: "Scheduled",
  pending: "Pending",
  overdue: "Overdue",
  paid: "Paid",
  upcoming: "Upcoming",
  reached: "Reached",
  open: "In progress",
};

export const statusLabel = (status: string | null) => (status ? (STATUS_LABELS[status] ?? status) : null);

const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null);

/** "09:00–10:30", "09:00", or "All day". */
export function timeLabel(item: CalendarItem) {
  if (item.all_day) return "All day";
  const start = hhmm(item.start_time);
  const end = hhmm(item.end_time);
  return end && end !== start ? `${start}–${end}` : (start ?? "");
}
