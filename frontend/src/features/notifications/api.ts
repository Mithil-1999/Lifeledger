import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type NotificationType =
  | "task_overdue"
  | "task_upcoming"
  | "bill_overdue"
  | "bill_upcoming"
  | "budget_threshold"
  | "savings_milestone"
  | "reminder_due";

export type RelatedType = "task" | "bill" | "budget" | "savings_goal" | "reminder";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  related_type: RelatedType;
  related_id: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotificationList {
  items: AppNotification[];
  total: number;
  unread_count: number;
}

export interface NotificationPreferences {
  task_overdue: boolean;
  task_upcoming: boolean;
  bill_overdue: boolean;
  bill_upcoming: boolean;
  budget_threshold: boolean;
  savings_milestone: boolean;
  reminder_due: boolean;
  task_lead_days: number;
  bill_lead_days: number;
  browser_enabled: boolean;
}

export interface NotificationFilters {
  status: "all" | "unread";
  type?: NotificationType;
  limit: number;
}

/** How often the app looks for new notifications while it's open. */
export const POLL_MS = 60_000;

function listPath({ status, type, limit }: NotificationFilters) {
  const params = new URLSearchParams({ status, limit: String(limit) });
  if (type) params.set("type", type);
  return `/api/notifications?${params}`;
}

export const useNotifications = (filters: NotificationFilters, options: { poll?: boolean } = {}) =>
  useQuery({
    queryKey: ["notifications", "list", filters],
    queryFn: () => apiFetch<NotificationList>(listPath(filters)),
    placeholderData: keepPreviousData,
    refetchInterval: options.poll ? POLL_MS : false,
  });

export const usePreferences = () =>
  useQuery({
    queryKey: ["notifications", "preferences"],
    queryFn: () => apiFetch<NotificationPreferences & { updated_at: string }>("/api/notifications/preferences"),
  });

export function useNotificationMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications", "list"] });
  return {
    setRead: useMutation({
      mutationFn: ({ id, read }: { id: string; read: boolean }) =>
        apiFetch<AppNotification>(`/api/notifications/${id}`, { method: "PATCH", body: { read } }),
      onSuccess: invalidate,
    }),
    readAll: useMutation({
      mutationFn: () => apiFetch<{ count: number }>("/api/notifications/read-all", { method: "POST" }),
      onSuccess: invalidate,
    }),
    dismiss: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/api/notifications/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
    dismissRead: useMutation({
      mutationFn: () => apiFetch<{ count: number }>("/api/notifications/dismiss-read", { method: "POST" }),
      onSuccess: invalidate,
    }),
    check: useMutation({
      mutationFn: () => apiFetch<{ created: number; unread_count: number }>("/api/notifications/check", { method: "POST" }),
      onSuccess: (result) => (result.created > 0 ? invalidate() : undefined),
    }),
    savePreferences: useMutation({
      mutationFn: (prefs: NotificationPreferences) =>
        apiFetch<NotificationPreferences & { updated_at: string }>("/api/notifications/preferences", { method: "PUT", body: prefs }),
      onSuccess: (saved) => queryClient.setQueryData(["notifications", "preferences"], saved),
    }),
  };
}
