import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Money } from "@/lib/format";

interface Section {
  available: boolean;
  available_from_phase: number | null;
}

export interface TaskItem {
  id: string;
  title: string;
  due_date: string | null;
  due_time?: string | null;
  priority: string | null;
  status?: string | null;
}

export interface BillItem {
  id: string;
  name: string;
  amount: Money;
  due_date: string;
}

export interface ReminderItem {
  id: string;
  title: string;
  remind_at: string;
  is_due?: boolean;
}

export interface MonthlyPoint {
  month: string;
  income?: string | null;
  expenses?: string | null;
  savings?: string | null;
}

export interface DashboardSummary {
  currency: string;
  period: { label: string; start: string; end: string; today: string; timezone: string };
  generated_at: string;
  finance: Section & {
    monthly_income: Money | null;
    monthly_expenses: Money | null;
    current_balance: Money | null;
    savings: Money | null;
    budget_remaining: Money | null;
    /** Metrics not computed yet -> phase that adds them. */
    pending?: Record<string, number>;
    /** Metrics that exist but aren't set up (no budgets this month, no savings goals). */
    not_configured?: string[];
  };
  tasks: Section & { today: TaskItem[]; pending: TaskItem[]; overdue: TaskItem[]; counts?: Record<string, number> };
  bills: Section & { upcoming: BillItem[]; overdue: BillItem[] };
  reminders: Section & { upcoming: ReminderItem[]; due_count?: number };
  charts: Section & {
    income_vs_expenses: MonthlyPoint[];
    expense_categories: { category: string; amount: string }[];
    monthly_spending: MonthlyPoint[];
    savings: MonthlyPoint[];
    pending?: Record<string, number>;
  };
}

export const DASHBOARD_QUERY_KEY = ["dashboard", "summary"] as const;

export function useDashboardSummary() {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: () => apiFetch<DashboardSummary>("/api/dashboard/summary"),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
