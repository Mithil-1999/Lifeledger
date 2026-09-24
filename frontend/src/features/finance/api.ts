import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type LedgerKind = "income" | "expense";
export type PaymentMethod = "cash" | "bank_transfer" | "card" | "mobile_wallet" | "cheque" | "other";
export type RecurrenceInterval = "weekly" | "monthly" | "quarterly" | "yearly";
export type SortOption = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

export interface Category {
  id: string;
  kind: LedgerKind;
  name: string;
  slug: string | null;
  is_system: boolean;
}

export interface LedgerRecord {
  id: string;
  amount: string; // exact decimal string, e.g. "1250.50"
  currency: string;
  date: string; // YYYY-MM-DD
  category: Category;
  payment_method: PaymentMethod;
  is_recurring: boolean;
  recurrence_interval: RecurrenceInterval | null;
  description: string | null;
  notes: string | null;
  source?: string; // income only
  created_at: string;
  updated_at: string;
}

export interface LedgerInput {
  amount: string;
  date: string;
  category_id: string;
  payment_method: PaymentMethod;
  is_recurring: boolean;
  recurrence_interval: RecurrenceInterval | null;
  description: string | null;
  notes: string | null;
  source?: string;
}

export interface LedgerPage {
  items: LedgerRecord[];
  total_count: number;
  total_amount: string;
  currency: string;
  page: number;
  page_size: number;
}

export interface LedgerSummary {
  year: number;
  currency: string;
  year_total: string;
  year_count: number;
  current_month: string;
  current_month_total: string;
  months: { month: string; total: string; count: number }[];
  by_category: { category_id: string; category: string; total: string; count: number }[];
}

export interface LedgerQuery {
  search?: string;
  category_id?: string;
  payment_method?: string;
  date_from?: string;
  date_to?: string;
  is_recurring?: string;
  sort?: SortOption;
  page?: number;
  page_size?: number;
}

export const API_PATH: Record<LedgerKind, string> = { income: "/api/incomes", expense: "/api/expenses" };

function toQueryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// --- Queries ------------------------------------------------------------------------------

export function useCategories(kind: LedgerKind) {
  return useQuery({
    queryKey: ["categories", kind],
    queryFn: () => apiFetch<Category[]>(`/api/categories?kind=${kind}`),
    staleTime: 5 * 60_000,
  });
}

export function useLedgerList(kind: LedgerKind, query: LedgerQuery) {
  return useQuery({
    queryKey: ["ledger", kind, "list", query],
    queryFn: () => apiFetch<LedgerPage>(`${API_PATH[kind]}${toQueryString({ ...query })}`),
    placeholderData: keepPreviousData, // keep the table steady while filters change
  });
}

export function useLedgerSummary(kind: LedgerKind, year: number) {
  return useQuery({
    queryKey: ["ledger", kind, "summary", year],
    queryFn: () => apiFetch<LedgerSummary>(`${API_PATH[kind]}/summary?year=${year}`),
  });
}

// --- Mutations ----------------------------------------------------------------------------

/** Any change to money data refreshes lists, summaries and the dashboard. */
function useInvalidateMoney() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ledger"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
}

export function useSaveRecord(kind: LedgerKind) {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: LedgerInput }) =>
      apiFetch<LedgerRecord>(id ? `${API_PATH[kind]}/${id}` : API_PATH[kind], { method: id ? "PUT" : "POST", body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteRecord(kind: LedgerKind) {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`${API_PATH[kind]}/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useCategoryMutations(kind: LedgerKind) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["categories", kind] }),
      // Renames show up in record lists and charts.
      queryClient.invalidateQueries({ queryKey: ["ledger"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  return {
    create: useMutation({
      mutationFn: (name: string) => apiFetch<Category>("/api/categories", { method: "POST", body: { kind, name } }),
      onSuccess: invalidate,
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        apiFetch<Category>(`/api/categories/${id}`, { method: "PATCH", body: { name } }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/api/categories/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
  };
}
