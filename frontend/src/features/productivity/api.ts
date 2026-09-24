import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// --- Tasks ------------------------------------------------------------------------------------------

export type TaskStatus = "not_started" | "in_progress" | "completed" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskRecurrence = "daily" | "weekly" | "monthly" | "yearly";
export type TaskView = "today" | "upcoming" | "overdue" | "completed" | "all";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  due_time: string | null; // "HH:MM:SS"
  recurrence: TaskRecurrence | null;
  created_at: string;
  completed_at: string | null;
  previous_task_id: string | null;
  is_overdue: boolean;
  is_due_soon: boolean;
}

export interface TaskInput {
  title: string;
  description: string | null;
  category: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  due_time: string | null;
  recurrence: TaskRecurrence | null;
}

export interface TaskList {
  view: TaskView;
  items: Task[];
  counts: Record<TaskView, number>;
}

export interface PendingTasks {
  due_soon_days: number;
  overdue: Task[];
  due_soon: Task[];
  not_started: Task[];
}

export interface TaskFilters {
  search?: string;
  priority?: string;
  category?: string;
  status?: string;
}

function query(params: Record<string, string | undefined>) {
  const search = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const useTasks = (view: TaskView, filters: TaskFilters) =>
  useQuery({
    queryKey: ["tasks", "list", view, filters],
    queryFn: () => apiFetch<TaskList>(`/api/tasks${query({ view, ...filters })}`),
    placeholderData: keepPreviousData,
  });

export const usePendingTasks = () =>
  useQuery({ queryKey: ["tasks", "pending"], queryFn: () => apiFetch<PendingTasks>("/api/tasks/pending") });

export const useTaskCategories = () =>
  useQuery({ queryKey: ["tasks", "categories"], queryFn: () => apiFetch<string[]>("/api/tasks/categories") });

function useInvalidate(key: string) {
  const queryClient = useQueryClient();
  return () => Promise.all([queryClient.invalidateQueries({ queryKey: [key] }), queryClient.invalidateQueries({ queryKey: ["dashboard"] })]);
}

export function useTaskMutations() {
  const invalidate = useInvalidate("tasks");
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id?: string; input: TaskInput }) =>
        apiFetch<Task>(id ? `/api/tasks/${id}` : "/api/tasks", { method: id ? "PUT" : "POST", body: input }),
      onSuccess: invalidate,
    }),
    setStatus: useMutation({
      mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
        apiFetch<Task>(`/api/tasks/${id}/status`, { method: "PATCH", body: { status } }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/api/tasks/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
  };
}

// --- Reminders ----------------------------------------------------------------------------------------

export type ReminderRepeat = "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
export type IntervalUnit = "days" | "weeks" | "months" | "years";
export type ReminderView = "due" | "upcoming" | "completed" | "all";

export interface Reminder {
  id: string;
  title: string;
  notes: string | null;
  remind_at: string;
  repeat: ReminderRepeat;
  interval_count: number | null;
  interval_unit: IntervalUnit | null;
  status: "active" | "completed";
  snoozed_until: string | null;
  completed_at: string | null;
  last_completed_at: string | null;
  created_at: string;
  effective_at: string;
  is_due: boolean;
  is_snoozed: boolean;
}

export interface ReminderInput {
  title: string;
  notes: string | null;
  remind_at: string; // ISO with offset
  repeat: ReminderRepeat;
  interval_count: number | null;
  interval_unit: IntervalUnit | null;
}

export interface ReminderList {
  view: ReminderView;
  items: Reminder[];
  counts: Record<ReminderView, number>;
}

export const useReminders = (view: ReminderView) =>
  useQuery({
    queryKey: ["reminders", view],
    queryFn: () => apiFetch<ReminderList>(`/api/reminders?view=${view}`),
    placeholderData: keepPreviousData,
    // Keep "due now" accurate while the page is open.
    refetchInterval: 60_000,
  });

export function useReminderMutations() {
  const invalidate = useInvalidate("reminders");
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id?: string; input: ReminderInput }) =>
        apiFetch<Reminder>(id ? `/api/reminders/${id}` : "/api/reminders", { method: id ? "PUT" : "POST", body: input }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/api/reminders/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
    snooze: useMutation({
      mutationFn: ({ id, ...body }: { id: string; minutes?: number; until?: string }) =>
        apiFetch<Reminder>(`/api/reminders/${id}/snooze`, { method: "POST", body }),
      onSuccess: invalidate,
    }),
    complete: useMutation({
      mutationFn: (id: string) => apiFetch<Reminder>(`/api/reminders/${id}/complete`, { method: "POST" }),
      onSuccess: invalidate,
    }),
  };
}
