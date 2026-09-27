import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { FormField } from "@/components/forms/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getErrorMessage } from "@/lib/api";
import { useCalendarEvent, useEventMutations, type CalendarEvent } from "./api";
import { EVENT_CATEGORIES, EVENT_RECURRENCE, EVENT_TYPES, REMINDER_OPTIONS } from "./constants";
import { daysBetween } from "./dates";

const eventSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a title.").max(200, "Use at most 200 characters."),
    event_type: z.enum(["appointment", "personal", "deadline"]),
    category: z.enum(["personal", "work", "health", "family", "finance", "education", "social", "travel", "other"]),
    all_day: z.boolean(),
    start_date: z.string().min(1, "Choose a date."),
    start_time: z.string(),
    end_date: z.string(),
    end_time: z.string(),
    recurrence: z.enum(["", "daily", "weekly", "monthly", "yearly"]),
    reminder: z.string(),
    location: z.string().trim().max(200, "Use at most 200 characters."),
    description: z.string().trim().max(2000, "Use at most 2000 characters."),
  })
  .superRefine((v, ctx) => {
    if (!v.all_day && !v.start_time) ctx.addIssue({ code: "custom", path: ["start_time"], message: "Choose a start time, or make it all-day." });
    if (v.start_date && (v.start_date < "2000-01-01" || v.start_date > "2100-12-31"))
      ctx.addIssue({ code: "custom", path: ["start_date"], message: "Choose a date between 2000 and 2100." });
    if (v.end_date && v.start_date) {
      if (v.end_date < v.start_date) ctx.addIssue({ code: "custom", path: ["end_date"], message: "The end date can't be before the start." });
      else if (daysBetween(v.start_date, v.end_date) > 366) ctx.addIssue({ code: "custom", path: ["end_date"], message: "An event can last at most a year." });
    }
    const sameDay = !v.end_date || v.end_date === v.start_date;
    if (!v.all_day && v.end_time && v.start_time && sameDay && v.end_time < v.start_time)
      ctx.addIssue({ code: "custom", path: ["end_time"], message: "The end time can't be before the start time." });
  });
type EventFormInput = z.input<typeof eventSchema>;
type EventFormValues = z.output<typeof eventSchema>;

const hhmm = (time: string | null) => (time ? time.slice(0, 5) : "");

function defaults(event: CalendarEvent | null, defaultDate: string): EventFormInput {
  return {
    title: event?.title ?? "",
    event_type: event?.event_type ?? "personal",
    category: event?.category ?? "personal",
    all_day: event ? event.all_day : true,
    start_date: event?.start_date ?? defaultDate,
    start_time: hhmm(event?.start_time ?? null),
    end_date: event && event.end_date !== event.start_date ? event.end_date : "",
    end_time: hhmm(event?.end_time ?? null),
    recurrence: event?.recurrence ?? "",
    reminder: event?.reminder_minutes == null ? "" : String(event.reminder_minutes),
    location: event?.location ?? "",
    description: event?.description ?? "",
  };
}

function EventForm({ event, defaultDate, onDone }: { event: CalendarEvent | null; defaultDate: string; onDone: () => void }) {
  const { save } = useEventMutations();
  const { register, handleSubmit, control, formState: { errors } } = useForm<EventFormInput, unknown, EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: defaults(event, defaultDate),
  });
  const allDay = useWatch({ control, name: "all_day" });
  const recurrence = useWatch({ control, name: "recurrence" });
  const reminder = useWatch({ control, name: "reminder" });

  const onSubmit = handleSubmit((v) =>
    save.mutate(
      {
        id: event?.id,
        input: {
          title: v.title,
          description: v.description || null,
          location: v.location || null,
          event_type: v.event_type,
          category: v.category,
          start_date: v.start_date,
          end_date: v.end_date || null,
          start_time: v.all_day ? null : v.start_time,
          end_time: v.all_day ? null : v.end_time || null,
          recurrence: v.recurrence || null,
          reminder_minutes: v.reminder === "" ? null : Number(v.reminder),
        },
      },
      {
        onSuccess: (saved) => {
          toast.success(event ? "Event updated." : "Event added.");
          if (saved.reminder_minutes !== null && saved.reminder_id === null) {
            toast.info("No reminder was set because the event has already started.");
          }
          onDone();
        },
      },
    ),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {save.isError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <span>{getErrorMessage(save.error)}</span>
        </Alert>
      )}
      <FormField id="event-title" label="Title" error={errors.title?.message}>
        {(aria) => <Input {...aria} placeholder="e.g. Dentist appointment" autoFocus {...register("title")} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="event-type" label="Type">
          {(aria) => (
            <NativeSelect {...aria} {...register("event_type")}>
              {Object.entries(EVENT_TYPES).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="event-category" label="Category">
          {(aria) => (
            <NativeSelect {...aria} {...register("category")}>
              {Object.entries(EVENT_CATEGORIES).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="size-4 accent-primary" {...register("all_day")} />
        All-day
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="event-start-date" label="Starts" error={errors.start_date?.message}>
          {(aria) => <Input {...aria} type="date" {...register("start_date")} />}
        </FormField>
        {!allDay && (
          <FormField id="event-start-time" label="Start time" error={errors.start_time?.message}>
            {(aria) => <Input {...aria} type="time" {...register("start_time")} />}
          </FormField>
        )}
        <FormField id="event-end-date" label="Ends" error={errors.end_date?.message} hint="Leave empty for a single day.">
          {(aria) => <Input {...aria} type="date" {...register("end_date")} />}
        </FormField>
        {!allDay && (
          <FormField id="event-end-time" label="End time" error={errors.end_time?.message} hint="Optional.">
            {(aria) => <Input {...aria} type="time" {...register("end_time")} />}
          </FormField>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="event-recurrence" label="Repeats">
          {(aria) => (
            <NativeSelect {...aria} {...register("recurrence")}>
              <option value="">Doesn't repeat</option>
              {Object.entries(EVENT_RECURRENCE).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="event-reminder" label="Remind me">
          {(aria) => (
            <NativeSelect {...aria} {...register("reminder")}>
              <option value="">No reminder</option>
              {REMINDER_OPTIONS.map((o) => (
                <option key={o.value} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      {(recurrence || reminder) && (
        <p className="-mt-2 text-xs text-muted-foreground">
          {recurrence && event ? "Changes apply to every occurrence. " : ""}
          {reminder ? `The reminder appears in Reminders${allDay ? " (all-day events count from 09:00)" : ""}.` : ""}
        </p>
      )}

      <FormField id="event-location" label="Location" error={errors.location?.message}>
        {(aria) => <Input {...aria} placeholder="Optional" {...register("location")} />}
      </FormField>
      <FormField id="event-description" label="Notes" error={errors.description?.message}>
        {(aria) => <Textarea {...aria} rows={3} placeholder="Optional" {...register("description")} />}
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {event ? "Save changes" : "Add event"}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface EventFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this event (fetched fresh, so recurring series edit from their first date). */
  eventId: string | null;
  /** Start date for a new event. */
  defaultDate: string;
}

/** Remount (change `key`) each time it opens so the form starts from fresh values. */
export function EventFormDialog({ open, onOpenChange, eventId, defaultDate }: EventFormDialogProps) {
  const { data: event, isError, error, refetch } = useCalendarEvent(open ? eventId : null);
  const waiting = eventId !== null && !event;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{eventId ? "Edit event" : "Add event"}</DialogTitle>
          <DialogDescription>Appointments, personal events and deadlines. Times use your local time.</DialogDescription>
        </DialogHeader>
        {waiting ? (
          isError ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
                <span>Couldn't load the event. {getErrorMessage(error)}</span>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            </Alert>
          ) : (
            <div className="grid gap-3" aria-label="Loading event">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-24" />
            </div>
          )
        ) : (
          <EventForm event={event ?? null} defaultDate={defaultDate} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
