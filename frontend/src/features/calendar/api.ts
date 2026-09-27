import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type CalendarSource = "event" | "task" | "reminder" | "bill" | "goal";
export type EventType = "appointment" | "personal" | "deadline";
export type EventCategory = "personal" | "work" | "health" | "family" | "finance" | "education" | "social" | "travel" | "other";
export type EventRecurrence = "daily" | "weekly" | "monthly" | "yearly";

/** One occurrence on the calendar. Dates are "YYYY-MM-DD", times "HH:MM:SS" (APP_TIMEZONE wall clock). */
export interface CalendarItem {
  key: string;
  source: CalendarSource;
  source_id: string;
  title: string;
  date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  kind: string;
  category: string | null;
  status: string | null;
  is_done: boolean;
  is_overdue: boolean;
  is_projected: boolean;
  description: string | null;
  location: string | null;
  amount: string | null;
  currency: string | null;
  priority: string | null;
  recurrence: string | null;
  reminder_minutes: number | null;
}

export interface CalendarFeed {
  start: string;
  end: string;
  today: string;
  items: CalendarItem[];
  counts: Partial<Record<CalendarSource, number>>;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  event_type: EventType;
  category: EventCategory;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  recurrence: EventRecurrence | null;
  reminder_minutes: number | null;
  reminder_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventInput {
  title: string;
  description: string | null;
  location: string | null;
  event_type: EventType;
  category: EventCategory;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  recurrence: EventRecurrence | null;
  reminder_minutes: number | null;
}

export const ALL_SOURCES: CalendarSource[] = ["event", "task", "reminder", "bill", "goal"];

export interface CalendarQuery {
  start: string;
  end: string;
  search?: string;
  sources: CalendarSource[];
  category?: string;
}

export function calendarPath({ start, end, search, sources, category }: CalendarQuery) {
  const params = new URLSearchParams({ start, end });
  if (search) params.set("search", search);
  if (sources.length < ALL_SOURCES.length) params.set("sources", sources.join(","));
  if (category) params.set("category", category);
  return `/api/calendar?${params}`;
}

export const useCalendar = (query: CalendarQuery) =>
  useQuery({
    queryKey: ["calendar", "feed", query],
    queryFn: () => apiFetch<CalendarFeed>(calendarPath(query)),
    placeholderData: keepPreviousData,
    enabled: query.sources.length > 0,
  });

export const useCalendarEvent = (id: string | null) =>
  useQuery({
    queryKey: ["calendar", "event", id],
    queryFn: () => apiFetch<CalendarEvent>(`/api/calendar/events/${id}`),
    enabled: id !== null,
  });

export function useEventMutations() {
  const queryClient = useQueryClient();
  // An event's "remind me" lives in the Reminders module, which the dashboard also shows.
  const invalidate = () =>
    Promise.all(["calendar", "reminders", "dashboard"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id?: string; input: EventInput }) =>
        apiFetch<CalendarEvent>(id ? `/api/calendar/events/${id}` : "/api/calendar/events", { method: id ? "PUT" : "POST", body: input }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/api/calendar/events/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
  };
}
