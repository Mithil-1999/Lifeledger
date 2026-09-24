import { Banknote, Droplets, House, Landmark, type LucideIcon, Receipt, Repeat, ShieldCheck, Smartphone, Wifi, Zap } from "lucide-react";
import type { BillCategory, BillFrequency, BillStatus, BudgetStatus } from "./api";

export const BILL_CATEGORIES: Record<BillCategory, { label: string; icon: LucideIcon }> = {
  rent: { label: "Room rent", icon: House },
  wifi: { label: "Wi-Fi", icon: Wifi },
  electricity: { label: "Electricity", icon: Zap },
  water: { label: "Water", icon: Droplets },
  mobile: { label: "Mobile", icon: Smartphone },
  subscription: { label: "Subscription", icon: Repeat },
  insurance: { label: "Insurance", icon: ShieldCheck },
  loan: { label: "Loan", icon: Landmark },
  other: { label: "Other", icon: Receipt },
};

export const BILL_FREQUENCIES: Record<BillFrequency, string> = {
  one_time: "One-time",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export const BILL_STATUS: Record<BillStatus, { label: string; variant: "warning" | "success" | "destructive" }> = {
  pending: { label: "Pending", variant: "warning" },
  paid: { label: "Paid", variant: "success" },
  overdue: { label: "Overdue", variant: "destructive" },
};

export const BUDGET_STATUS: Record<BudgetStatus, { label: string; variant: "success" | "warning" | "destructive" }> = {
  ok: { label: "On track", variant: "success" },
  warning: { label: "Near limit", variant: "warning" },
  over: { label: "Over budget", variant: "destructive" },
};

export const SavingsIcon = Banknote;

/** "2026-09" for the browser's current month. */
export function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(yearMonth: string, delta: number) {
  const [year, month] = yearMonth.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** "Due in 3 days", "Due today", "4 days overdue". */
export function dueLabel(days: number) {
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days > 1) return `Due in ${days} days`;
  return days === -1 ? "1 day overdue" : `${-days} days overdue`;
}
