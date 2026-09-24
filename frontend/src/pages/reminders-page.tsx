import * as React from "react";
import { useSearchParams } from "react-router";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlarmClock, AlertCircle, BellRing, Check, Clock, Loader2, MoreHorizontal, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { FormField } from "@/components/forms/form-field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useReminderMutations, useReminders, type Reminder, type ReminderView } from "@/features/productivity/api";
import {
  INTERVAL_UNITS,
  REMINDER_REPEAT,
  formatDateTime,
  fromLocalParts,
  relativeTime,
  repeatLabel,
  toLocalParts,
  tomorrowMorningIso,
} from "@/features/productivity/constants";
import { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

// --- Form ---------------------------------------------------------------------------------------------------

const reminderSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a title.").max(200, "Use at most 200 characters."),
    notes: z.string().trim().max(2000, "Use at most 2000 characters."),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
    time: z.string().regex(/^\d{2}:\d{2}$/, "Choose a time."),
    repeat: z.enum(["none", "daily", "weekly", "monthly", "yearly", "custom"]),
    interval_count: z.string(),
    interval_unit: z.enum(["days", "weeks", "months", "years"]),
  })
  .superRefine((v, ctx) => {
    if (v.repeat === "custom") {
      const n = Number(v.interval_count);
      if (!Number.isInteger(n) || n < 1 || n > 365) ctx.addIssue({ code: "custom", path: ["interval_count"], message: "Use a whole number from 1 to 365." });
    }
  });
type ReminderFormInput = z.input<typeof reminderSchema>;
type ReminderFormValues = z.output<typeof reminderSchema>;

function defaultTime() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return toLocalParts(d.toISOString());
}

function ReminderFormDialog({ open, onOpenChange, reminder }: { open: boolean; onOpenChange: (open: boolean) => void; reminder: Reminder | null }) {
  const { save } = useReminderMutations();
  const defaults = React.useCallback((): ReminderFormInput => {
    const when = reminder ? toLocalParts(reminder.remind_at) : defaultTime();
    return {
      title: reminder?.title ?? "",
      notes: reminder?.notes ?? "",
      date: when.date,
      time: when.time,
      repeat: reminder?.repeat ?? "none",
      interval_count: String(reminder?.interval_count ?? 2),
      interval_unit: reminder?.interval_unit ?? "weeks",
    };
  }, [reminder]);
  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<ReminderFormInput, unknown, ReminderFormValues>({
    resolver: zodResolver(reminderSchema),
    defaultValues: defaults(),
  });
  const repeat = useWatch({ control, name: "repeat" });
  React.useEffect(() => {
    if (open) {
      reset(defaults());
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults]);

  const onSubmit = handleSubmit((v) =>
    save.mutate(
      {
        id: reminder?.id,
        input: {
          title: v.title,
          notes: v.notes || null,
          remind_at: fromLocalParts(v.date, v.time),
          repeat: v.repeat,
          interval_count: v.repeat === "custom" ? Number(v.interval_count) : null,
          interval_unit: v.repeat === "custom" ? v.interval_unit : null,
        },
      },
      {
        onSuccess: () => {
          toast.success(reminder ? "Reminder updated." : "Reminder added.");
          onOpenChange(false);
        },
      },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{reminder ? "Edit reminder" : "Add reminder"}</DialogTitle>
          <DialogDescription>Reminders show up in LifeVault when they're due.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {save.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(save.error)}</span>
            </Alert>
          )}
          <FormField id="reminder-title" label="Title" error={errors.title?.message}>
            {(aria) => <Input {...aria} placeholder="e.g. Pay electricity bill" autoFocus {...register("title")} />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="reminder-date" label="Date" error={errors.date?.message}>
              {(aria) => <Input {...aria} type="date" {...register("date")} />}
            </FormField>
            <FormField id="reminder-time" label="Time" error={errors.time?.message}>
              {(aria) => <Input {...aria} type="time" {...register("time")} />}
            </FormField>
            <FormField id="reminder-repeat" label="Repeat">
              {(aria) => (
                <NativeSelect {...aria} {...register("repeat")}>
                  {Object.entries(REMINDER_REPEAT).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
          {repeat === "custom" && (
            <div className="grid grid-cols-[auto_1fr_1fr] items-end gap-3 rounded-lg border p-3">
              <span className="pb-2.5 text-sm font-medium">Every</span>
              <FormField id="reminder-interval-count" label="Number" error={errors.interval_count?.message}>
                {(aria) => <Input {...aria} type="number" min={1} max={365} step={1} {...register("interval_count")} />}
              </FormField>
              <FormField id="reminder-interval-unit" label="Unit">
                {(aria) => (
                  <NativeSelect {...aria} {...register("interval_unit")}>
                    {Object.entries(INTERVAL_UNITS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            </div>
          )}
          <FormField id="reminder-notes" label="Notes" error={errors.notes?.message}>
            {(aria) => <Textarea {...aria} rows={3} placeholder="Optional" {...register("notes")} />}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {reminder ? "Save changes" : "Add reminder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Row --------------------------------------------------------------------------------------------------------

const SNOOZE_OPTIONS: { label: string; minutes?: number; until?: () => string }[] = [
  { label: "10 minutes", minutes: 10 },
  { label: "1 hour", minutes: 60 },
  { label: "3 hours", minutes: 180 },
  { label: "Tomorrow 9:00", until: tomorrowMorningIso },
];

function ReminderRow({ reminder, onEdit, onDelete }: { reminder: Reminder; onEdit: () => void; onDelete: () => void }) {
  const { snooze, complete } = useReminderMutations();
  const active = reminder.status === "active";
  const busy = snooze.isPending || complete.isPending;

  const doComplete = () =>
    complete.mutate(reminder.id, {
      onSuccess: (updated) =>
        toast.success(updated.status === "completed" ? "Reminder completed." : `Done. Next: ${formatDateTime(updated.remind_at)}.`),
      onError: (e) => toast.error(getErrorMessage(e)),
    });
  const doSnooze = (option: (typeof SNOOZE_OPTIONS)[number]) =>
    snooze.mutate(
      { id: reminder.id, ...(option.minutes ? { minutes: option.minutes } : { until: option.until!() }) },
      {
        onSuccess: (updated) => toast.success(`Snoozed until ${formatDateTime(updated.effective_at)}.`),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );

  return (
    <li className={cn("flex min-w-0 items-start gap-3 rounded-xl border bg-card p-3", reminder.is_due && "border-primary/50 bg-accent/30")}>
      <span
        className={cn(
          "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
          reminder.is_due ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground",
        )}
      >
        <BellRing className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("min-w-0 truncate font-medium", !active && "text-muted-foreground line-through")}>{reminder.title}</span>
          {reminder.is_due && <Badge>Due now</Badge>}
          {reminder.is_snoozed && (
            <Badge variant="outline">
              <AlarmClock aria-hidden /> Snoozed
            </Badge>
          )}
          {!active && <Badge variant="success">Completed</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" aria-hidden />
            <time dateTime={reminder.effective_at}>{formatDateTime(reminder.effective_at)}</time>
            {active && <span>({relativeTime(reminder.effective_at)})</span>}
          </span>
          {reminder.repeat !== "none" && (
            <span className="inline-flex items-center gap-1">
              <Repeat className="size-3" aria-hidden /> {repeatLabel(reminder.repeat, reminder.interval_count, reminder.interval_unit)}
            </span>
          )}
        </div>
        {reminder.notes && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{reminder.notes}</p>}
        {active && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={doComplete} disabled={busy}>
              <Check aria-hidden /> {reminder.repeat === "none" ? "Complete" : "Done for now"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy}>
                  <AlarmClock aria-hidden /> Snooze
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Snooze for</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {SNOOZE_OPTIONS.map((option) => (
                  <DropdownMenuItem key={option.label} onSelect={() => doSnooze(option)}>
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${reminder.title}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDelete} className="text-destructive data-[highlighted]:text-destructive">
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

// --- Page -----------------------------------------------------------------------------------------------------------

const VIEWS: { value: ReminderView; label: string }[] = [
  { value: "due", label: "Due" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

export function RemindersPage() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = React.useState<ReminderView>("upcoming");
  const [formOpen, setFormOpen] = React.useState(() => params.get("new") === "1");
  const [editing, setEditing] = React.useState<Reminder | null>(null);
  const [deleting, setDeleting] = React.useState<Reminder | null>(null);
  const { data, isPending, isError, error, refetch } = useReminders(view);
  const { remove } = useReminderMutations();

  React.useEffect(() => {
    if (params.get("new") === "1") setParams({}, { replace: true });
  }, [params, setParams]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Reminders"
        description="One-time and repeating reminders. Snooze or complete them when they're due."
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden /> Add reminder
          </Button>
        }
      />

      {data && data.counts.due > 0 && view !== "due" && (
        <Alert variant="info">
          <BellRing aria-hidden />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
            <span>
              {data.counts.due} reminder{data.counts.due === 1 ? " is" : "s are"} due now.
            </span>
            <Button size="sm" variant="outline" onClick={() => setView("due")}>
              Show due
            </Button>
          </div>
        </Alert>
      )}

      <Tabs value={view} onValueChange={(v) => setView(v as ReminderView)}>
        <TabsList aria-label="Reminder views">
          {VIEWS.map((v) => (
            <TabsTrigger key={v.value} value={v.value}>
              {v.label}
              {data && <span className="tabular-nums text-muted-foreground">{data.counts[v.value]}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <span>Couldn't load reminders. {getErrorMessage(error)}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : isPending ? (
        <div className="grid gap-2" aria-label="Loading reminders">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title={view === "due" ? "Nothing due right now" : view === "completed" ? "No completed reminders" : "No reminders yet"}
          description={view === "upcoming" || view === "all" ? "Add reminders for bills, appointments or anything you don't want to forget." : "Switch views to see other reminders."}
        >
          {(view === "upcoming" || view === "all") && (
            <Button onClick={openCreate}>
              <Plus aria-hidden /> Add reminder
            </Button>
          )}
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-2" aria-label="Reminders">
          {data.items.map((reminder) => (
            <ReminderRow
              key={reminder.id}
              reminder={reminder}
              onEdit={() => {
                setEditing(reminder);
                setFormOpen(true);
              }}
              onDelete={() => setDeleting(reminder)}
            />
          ))}
        </ul>
      )}

      <ReminderFormDialog open={formOpen} onOpenChange={setFormOpen} reminder={editing} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete “${deleting?.title}”?`}
        description="This reminder will be permanently deleted."
        confirmLabel="Delete reminder"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Reminder deleted.");
              setDeleting(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
