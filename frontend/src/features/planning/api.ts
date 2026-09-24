import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Category, PaymentMethod } from "@/features/finance/api";

// --- Types ---------------------------------------------------------------------------------------

export type BudgetStatus = "ok" | "warning" | "over";

export interface Budget {
  id: string;
  category: Category;
  month: string;
  amount: string;
  warning_threshold: number;
  spent: string;
  remaining: string;
  percent_used: string;
  status: BudgetStatus;
}

export interface BudgetMonth {
  month: string;
  currency: string;
  total_budget: string;
  total_spent: string;
  total_remaining: string;
  percent_used: string;
  unbudgeted_spent: string;
  budgets: Budget[];
}

export type BillCategory = "rent" | "wifi" | "electricity" | "water" | "mobile" | "subscription" | "insurance" | "loan" | "other";
export type BillFrequency = "one_time" | "weekly" | "monthly" | "quarterly" | "yearly";
export type BillStatus = "pending" | "paid" | "overdue";

export interface Bill {
  id: string;
  name: string;
  amount: string;
  currency: string;
  category: BillCategory;
  due_date: string;
  frequency: BillFrequency;
  status: BillStatus;
  days_until_due: number;
  notes: string | null;
  last_paid_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillsOverview {
  currency: string;
  items: Bill[];
  overdue_count: number;
  overdue_total: string;
  due_soon_count: number;
  due_soon_total: string;
  paid_this_month_total: string;
}

export interface BillInput {
  name: string;
  amount: string;
  category: BillCategory;
  due_date: string;
  frequency: BillFrequency;
  notes: string | null;
  status: "pending" | "paid";
}

export interface BillPayment {
  id: string;
  amount: string;
  paid_on: string;
  due_date: string;
  expense_id: string | null;
}

export interface SavingsGoal {
  id: string;
  name: string;
  target_amount: string;
  current_amount: string;
  currency: string;
  target_date: string | null;
  description: string | null;
  progress_percent: string;
  remaining_amount: string;
  completed: boolean;
  monthly_needed: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavingsOverview {
  currency: string;
  total_saved: string;
  total_target: string;
  progress_percent: string;
  goals: SavingsGoal[];
}

export interface GoalInput {
  name: string;
  target_amount: string;
  current_amount: string;
  target_date: string | null;
  description: string | null;
}

export interface Contribution {
  id: string;
  amount: string;
  date: string;
  note: string | null;
  created_at: string;
}

// --- Queries ---------------------------------------------------------------------------------------

export const useBudgetMonth = (month: string) =>
  useQuery({ queryKey: ["budgets", month], queryFn: () => apiFetch<BudgetMonth>(`/api/budgets?month=${month}`) });

export const useBills = (status: BillStatus | "all") =>
  useQuery({
    queryKey: ["bills", status],
    queryFn: () => apiFetch<BillsOverview>(status === "all" ? "/api/bills" : `/api/bills?status=${status}`),
  });

export const useBillPayments = (billId: string | null) =>
  useQuery({
    queryKey: ["bills", "payments", billId],
    queryFn: () => apiFetch<BillPayment[]>(`/api/bills/${billId}/payments`),
    enabled: billId !== null,
  });

export const useSavings = () =>
  useQuery({ queryKey: ["savings"], queryFn: () => apiFetch<SavingsOverview>("/api/savings-goals") });

export const useContributions = (goalId: string | null) =>
  useQuery({
    queryKey: ["savings", "contributions", goalId],
    queryFn: () => apiFetch<Contribution[]>(`/api/savings-goals/${goalId}/contributions`),
    enabled: goalId !== null,
  });

// --- Mutations -------------------------------------------------------------------------------------

/** Refresh the module plus everything derived from it (dashboard; expenses for bill payments). */
function useInvalidate(keys: string[][]) {
  const queryClient = useQueryClient();
  return () => Promise.all([...keys, ["dashboard"]].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

export function useBudgetMutations() {
  const invalidate = useInvalidate([["budgets"]]);
  return {
    save: useMutation({
      mutationFn: ({ id, ...body }: { id?: string; category_id?: string; month?: string; amount: string; warning_threshold: number }) =>
        id
          ? apiFetch<Budget>(`/api/budgets/${id}`, { method: "PUT", body: { amount: body.amount, warning_threshold: body.warning_threshold } })
          : apiFetch<Budget>("/api/budgets", { method: "POST", body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/api/budgets/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
    copy: useMutation({
      mutationFn: (body: { from_month: string; to_month: string }) =>
        apiFetch<{ copied: number; skipped: number }>("/api/budgets/copy", { method: "POST", body }),
      onSuccess: invalidate,
    }),
  };
}

export function useBillMutations() {
  const invalidate = useInvalidate([["bills"], ["ledger"]]);
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id?: string; input: BillInput }) =>
        apiFetch<Bill>(id ? `/api/bills/${id}` : "/api/bills", { method: id ? "PUT" : "POST", body: input }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/api/bills/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
    pay: useMutation({
      mutationFn: ({ id, ...body }: { id: string; paid_on: string; amount: string | null; record_expense: boolean; payment_method: PaymentMethod }) =>
        apiFetch<Bill>(`/api/bills/${id}/pay`, { method: "POST", body: { ...body, amount: body.amount || undefined } }),
      onSuccess: invalidate,
    }),
  };
}

export function useSavingsMutations() {
  const invalidate = useInvalidate([["savings"]]);
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id?: string; input: GoalInput }) =>
        apiFetch<SavingsGoal>(id ? `/api/savings-goals/${id}` : "/api/savings-goals", { method: id ? "PUT" : "POST", body: input }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/api/savings-goals/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
    contribute: useMutation({
      mutationFn: ({ id, ...body }: { id: string; kind: "deposit" | "withdrawal"; amount: string; date: string; note: string | null }) =>
        apiFetch<SavingsGoal>(`/api/savings-goals/${id}/contributions`, { method: "POST", body }),
      onSuccess: invalidate,
    }),
  };
}
