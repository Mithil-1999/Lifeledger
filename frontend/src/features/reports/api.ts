import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { SavingsGoal } from "@/features/planning/api";

/** Amounts are exact decimal strings ("1234.50"); percentages have one decimal ("87.5"). */
type Dec = string;

export type ReportKind = "finance" | "expenses" | "budget" | "savings" | "bills";

export interface ReportPeriod {
  kind: "month" | "year" | "range";
  start: string;
  end: string;
  label: string;
  trend_start: string;
  months: string[];
  trend_months: string[];
}

export interface Change {
  amount: Dec;
  /** null when the previous value was zero. */
  percent: Dec | null;
}

export interface FinanceReport {
  currency: string;
  period: ReportPeriod;
  totals: {
    income: Dec;
    expenses: Dec;
    net: Dec;
    savings_rate: Dec | null;
    savings_deposits: Dec;
    savings_withdrawals: Dec;
    savings: Dec;
    closing_balance: Dec | null;
    balance_as_of: string | null;
  };
  months: { month: string; income: Dec; expenses: Dec; net: Dec; savings: Dec; balance: Dec | null }[];
}

export interface ExpenseRow {
  id: string;
  date: string;
  category: string;
  description: string | null;
  amount: Dec;
  payment_method: string;
  is_recurring: boolean;
  recurrence_interval: string | null;
}

export interface ExpenseReport {
  currency: string;
  period: ReportPeriod;
  category_id: string | null;
  total: Dec;
  count: number;
  previous: { start: string; end: string; total: Dec; change: Change };
  by_category: { category_id: string; category: string; amount: Dec; count: number; percent: Dec | null; previous_amount: Dec; change: Change }[];
  largest: ExpenseRow[];
  recurring: {
    total: Dec;
    count: number;
    percent_of_total: Dec | null;
    items: { category: string; description: string | null; interval: string | null; count: number; total: Dec; last_amount: Dec; last_date: string }[];
  };
  monthly: { month: string; amount: Dec; change: Change | null }[];
}

export interface BudgetReport {
  currency: string;
  period: ReportPeriod;
  category_id: string | null;
  whole_months: boolean;
  totals: { budget: Dec; spent: Dec; remaining: Dec; percent_used: Dec | null; unbudgeted_spent: Dec | null };
  months: { month: string; budget: Dec; spent: Dec; remaining: Dec; percent_used: Dec | null; budgeted_categories: number; over_budget: number; unbudgeted_spent: Dec | null }[];
  categories: { category_id: string; category: string; budget: Dec; spent: Dec; remaining: Dec; percent_used: Dec | null; months_budgeted: number; months_over: number }[];
}

export interface SavingsReport {
  currency: string;
  period: ReportPeriod;
  totals: {
    deposits: Dec;
    withdrawals: Dec;
    net: Dec;
    total_saved: Dec;
    total_target: Dec;
    progress_percent: Dec | null;
    goals: number;
    completed_goals: number;
  };
  months: { month: string; deposits: Dec; withdrawals: Dec; net: Dec; total_saved: Dec | null }[];
  goals: (SavingsGoal & { saved_in_period: Dec })[];
}

export interface BillBrief {
  id: string;
  name: string;
  category: string;
  amount: Dec;
  due_date: string;
  frequency: string;
  days_until_due: number;
}

export interface BillsReport {
  currency: string;
  period: ReportPeriod;
  category: string | null;
  today: string;
  paid: {
    total: Dec;
    count: number;
    by_bill: { bill_id: string; name: string; category: string; count: number; total: Dec }[];
    by_category: { category: string; total: Dec }[];
  };
  pending: { total: Dec; count: number; items: BillBrief[] };
  overdue: { total: Dec; count: number; items: BillBrief[] };
  recurring: {
    count: number;
    by_frequency: { frequency: string; count: number; per_cycle: Dec; per_year: Dec }[];
    yearly_total: Dec;
    monthly_average: Dec;
  };
  monthly_paid: { month: string; amount: Dec }[];
}

export interface ReportData {
  finance: FinanceReport;
  expenses: ExpenseReport;
  budget: BudgetReport;
  savings: SavingsReport;
  bills: BillsReport;
}

/** Period + filters, as query parameters. Only one of month / year / (date_from + date_to) is sent. */
export type ReportParams = Record<string, string>;

export function reportPath(kind: ReportKind, params: ReportParams, csv = false) {
  const search = new URLSearchParams(params).toString();
  return `/api/reports/${kind}${csv ? "/export.csv" : ""}${search ? `?${search}` : ""}`;
}

export function useReport<K extends ReportKind>(kind: K, params: ReportParams, enabled = true) {
  return useQuery({
    queryKey: ["reports", kind, params],
    queryFn: () => apiFetch<ReportData[K]>(reportPath(kind, params)),
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === kind ? keepPreviousData(previous) : undefined),
    enabled,
  });
}
