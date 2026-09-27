import { BellRing, CircleAlert, Gauge, ListChecks, PiggyBank, ReceiptText, TriangleAlert, type LucideIcon } from "lucide-react";
import type { NotificationPreferences, NotificationType, RelatedType } from "./api";

export const NOTIFICATION_TYPES: Record<NotificationType, { label: string; description: string; icon: LucideIcon; tone: "danger" | "warning" | "info" | "success" }> = {
  task_overdue: { label: "Overdue tasks", description: "An open task has passed its due date or time.", icon: CircleAlert, tone: "danger" },
  task_upcoming: { label: "Upcoming tasks", description: "An open task is due soon.", icon: ListChecks, tone: "info" },
  bill_overdue: { label: "Overdue bills", description: "A bill is past its due date and not marked as paid.", icon: TriangleAlert, tone: "danger" },
  bill_upcoming: { label: "Upcoming bills", description: "A bill is due soon.", icon: ReceiptText, tone: "warning" },
  budget_threshold: { label: "Budget alerts", description: "A budget reaches its warning level, or is exceeded.", icon: Gauge, tone: "warning" },
  savings_milestone: { label: "Savings milestones", description: "A savings goal reaches 25%, 50%, 75% or 100%.", icon: PiggyBank, tone: "success" },
  reminder_due: { label: "Reminders", description: "A reminder's time arrives.", icon: BellRing, tone: "info" },
};

export const TYPE_ORDER = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

export const TONE_CLASSES = {
  danger: "bg-destructive/12 text-destructive",
  warning: "bg-warning/15 text-warning",
  info: "bg-accent text-accent-foreground",
  success: "bg-success/15 text-success",
} as const;

export const RELATED_LINKS: Record<RelatedType, { path: string; label: string }> = {
  task: { path: "/tasks", label: "Open Tasks" },
  bill: { path: "/bills", label: "Open Bills" },
  budget: { path: "/budget", label: "Open Budget" },
  savings_goal: { path: "/savings", label: "Open Savings" },
  reminder: { path: "/reminders", label: "Open Reminders" },
};

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  task_overdue: true,
  task_upcoming: true,
  bill_overdue: true,
  bill_upcoming: true,
  budget_threshold: true,
  savings_milestone: true,
  reminder_due: true,
  task_lead_days: 1,
  bill_lead_days: 3,
  browser_enabled: false,
};

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "5 minutes ago", "yesterday", or a date for anything older than a week. */
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(seconds / 86_400), "day");
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
