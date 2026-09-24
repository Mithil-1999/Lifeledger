import * as React from "react";
import { useSearchParams } from "react-router";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CalendarClock, CircleAlert, CirclePause, ListChecks, Loader2, MoreHorizontal, Pencil, Plus, Repeat, Search, SearchX, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { FormField } from "@/components/forms/form-field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  usePendingTasks,
  useTaskCategories,
  useTaskMutations,
  useTasks,
  type Task,
  type TaskStatus,
  type TaskView,
} from "@/features/productivity/api";
import { CATEGORY_SUGGESTIONS, TASK_PRIORITY, TASK_RECURRENCE, TASK_STATUS, shortTime } from "@/features/productivity/constants";
import { getErrorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// --- Form ----------------------------------------------------------------------------------------------

const taskSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a title.").max(200, "Use at most 200 characters."),
    description: z.string().trim().max(5000, "Use at most 5000 characters."),
    category: z.string().trim().max(50, "Use at most 50 characters."),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    status: z.enum(["not_started", "in_progress", "completed", "cancelled"]),
    due_date: z.string(),
    due_time: z.string(),
    recurrence: z.enum(["", "daily", "weekly", "monthly", "yearly"]),
  })
  .superRefine((v, ctx) => {
    if (v.due_time && !v.due_date) ctx.addIssue({ code: "custom", path: ["due_time"], message: "Add a due date to use a time." });
    if (v.recurrence && !v.due_date) ctx.addIssue({ code: "custom", path: ["recurrence"], message: "Recurring tasks need a due date." });
  });
type TaskFormInput = z.input<typeof taskSchema>;
type TaskFormValues = z.output<typeof taskSchema>;

function TaskFormDialog({ open, onOpenChange, task }: { open: boolean; onOpenChange: (open: boolean) => void; task: Task | null }) {
  const { save } = useTaskMutations();
  const { data: categories } = useTaskCategories();
  const defaults = React.useCallback(
    (): TaskFormInput => ({
      title: task?.title ?? "",
      description: task?.description ?? "",
      category: task?.category ?? "",
      priority: task?.priority ?? "medium",
      status: task?.status ?? "not_started",
      due_date: task?.due_date ?? "",
      due_time: shortTime(task?.due_time ?? null) ?? "",
      recurrence: task?.recurrence ?? "",
    }),
    [task],
  );
  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<TaskFormInput, unknown, TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: defaults(),
  });
  const recurrence = useWatch({ control, name: "recurrence" });
  React.useEffect(() => {
    if (open) {
      reset(defaults());
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults]);

  const suggestions = Array.from(new Set([...(categories ?? []), ...CATEGORY_SUGGESTIONS]));
  const onSubmit = handleSubmit((v) =>
    save.mutate(
      {
        id: task?.id,
        input: {
          title: v.title,
          description: v.description || null,
          category: v.category || null,
          priority: v.priority,
          status: v.status,
          due_date: v.due_date || null,
          due_time: v.due_time || null,
          recurrence: v.recurrence || null,
        },
      },
      {
        onSuccess: () => {
          toast.success(task ? "Task updated." : "Task added.");
          onOpenChange(false);
        },
      },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "Add task"}</DialogTitle>
          <DialogDescription>Due dates and times use your local time.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {save.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(save.error)}</span>
            </Alert>
          )}
          <FormField id="task-title" label="Title" error={errors.title?.message}>
            {(aria) => <Input {...aria} placeholder="e.g. Pay internet bill" autoFocus {...register("title")} />}
          </FormField>
          <FormField id="task-description" label="Description" error={errors.description?.message}>
            {(aria) => <Textarea {...aria} rows={3} placeholder="Optional" {...register("description")} />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="task-category" label="Category" error={errors.category?.message}>
              {(aria) => (
                <>
                  <Input {...aria} list="task-category-options" placeholder="e.g. Home" {...register("category")} />
                  <datalist id="task-category-options">
                    {suggestions.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </>
              )}
            </FormField>
            <FormField id="task-priority" label="Priority">
              {(aria) => (
                <NativeSelect {...aria} {...register("priority")}>
                  {Object.entries(TASK_PRIORITY).map(([value, { label }]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField id="task-status" label="Status">
              {(aria) => (
                <NativeSelect {...aria} {...register("status")}>
                  {Object.entries(TASK_STATUS).map(([value, { label }]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="task-due-date" label="Due date" error={errors.due_date?.message}>
              {(aria) => <Input {...aria} type="date" {...register("due_date")} />}
            </FormField>
            <FormField id="task-due-time" label="Due time" error={errors.due_time?.message}>
              {(aria) => <Input {...aria} type="time" {...register("due_time")} />}
            </FormField>
            <FormField id="task-recurrence" label="Repeats" error={errors.recurrence?.message}>
              {(aria) => (
                <NativeSelect {...aria} {...register("recurrence")}>
                  <option value="">Doesn't repeat</option>
                  {Object.entries(TASK_RECURRENCE).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
          {recurrence && (
            <p className="text-xs text-muted-foreground">When you complete it, the next occurrence is created automatically.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {task ? "Save changes" : "Add task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Rows -----------------------------------------------------------------------------------------------

function DueLabel({ task }: { task: Task }) {
  if (!task.due_date) return <span className="text-muted-foreground">No due date</span>;
  const time = shortTime(task.due_time);
  return (
    <span className={cn(task.is_overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
      {task.is_overdue ? "Overdue · " : "Due "}
      {formatDate(task.due_date, { weekday: "short", day: "numeric", month: "short" })}
      {time ? ` ${time}` : ""}
    </span>
  );
}

function TaskRow({ task, onEdit, onDelete }: { task: Task; onEdit: () => void; onDelete: () => void }) {
  const { setStatus } = useTaskMutations();
  const done = task.status === "completed";
  const change = (status: TaskStatus) =>
    setStatus.mutate(
      { id: task.id, status },
      {
        onSuccess: () =>
          toast.success(
            status === "completed" && task.recurrence ? "Completed. The next occurrence has been added." : `Marked ${TASK_STATUS[status].label.toLowerCase()}.`,
          ),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );

  return (
    <li className={cn("flex min-w-0 items-start gap-3 rounded-xl border bg-card p-3", task.is_overdue && "border-destructive/40")}>
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0 accent-primary"
        checked={done}
        disabled={setStatus.isPending || task.status === "cancelled"}
        onChange={() => change(done ? "not_started" : "completed")}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as completed`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("min-w-0 truncate font-medium", (done || task.status === "cancelled") && "text-muted-foreground line-through")}>{task.title}</span>
          <Badge variant={TASK_PRIORITY[task.priority].variant}>{TASK_PRIORITY[task.priority].label}</Badge>
          {task.status !== "not_started" && <Badge variant={TASK_STATUS[task.status].variant}>{TASK_STATUS[task.status].label}</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <DueLabel task={task} />
          {task.category && (
            <>
              <span aria-hidden className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{task.category}</span>
            </>
          )}
          {task.recurrence && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Repeat className="size-3" aria-hidden /> {TASK_RECURRENCE[task.recurrence]}
            </span>
          )}
          {done && task.completed_at && (
            <span className="text-muted-foreground">
              · Completed {formatDate(task.completed_at.slice(0, 10), { day: "numeric", month: "short" })}
            </span>
          )}
        </div>
        {task.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.description}</p>}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${task.title}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Status</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={task.status} onValueChange={(value) => change(value as TaskStatus)}>
            {Object.entries(TASK_STATUS).map(([value, { label }]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
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

// --- "You haven't worked on these tasks" ------------------------------------------------------------------

function PendingTasksCard({ onEdit }: { onEdit: (task: Task) => void }) {
  const { data } = usePendingTasks();
  if (!data) return null;
  const groups = [
    { key: "overdue", label: "Overdue", icon: CircleAlert, tone: "text-destructive", items: data.overdue },
    { key: "due_soon", label: `Due in the next ${data.due_soon_days} days`, icon: CalendarClock, tone: "text-warning", items: data.due_soon },
    { key: "not_started", label: "Not started", icon: CirclePause, tone: "text-muted-foreground", items: data.not_started },
  ].filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>You haven't worked on these tasks</CardTitle>
        <CardDescription>Tasks whose status is still “Not started”.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        {groups.map(({ key, label, icon: Icon, tone, items }) => (
          <section key={key} aria-labelledby={`pending-${key}`} className="min-w-0">
            <h3 id={`pending-${key}`} className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <Icon className={cn("size-4", tone)} aria-hidden /> {label}
              <span className="text-muted-foreground">({items.length})</span>
            </h3>
            <ul className="grid gap-1.5">
              {items.slice(0, 5).map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => onEdit(task)}
                    className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 text-left text-sm hover:bg-accent/40"
                  >
                    <span className="truncate">{task.title}</span>
                    {task.due_date && (
                      <span className="shrink-0 text-xs text-muted-foreground">{formatDate(task.due_date, { day: "numeric", month: "short" })}</span>
                    )}
                  </button>
                </li>
              ))}
              {items.length > 5 && <li className="px-1 text-xs text-muted-foreground">+{items.length - 5} more</li>}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

// --- Page ------------------------------------------------------------------------------------------------

const VIEWS: { value: TaskView; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "overdue", label: "Overdue" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

const EMPTY_TEXT: Record<TaskView, string> = {
  today: "Nothing due today.",
  upcoming: "No upcoming tasks.",
  overdue: "Nothing overdue. Nice!",
  completed: "No completed tasks yet.",
  all: "No tasks yet.",
};

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = React.useState<TaskView>("today");
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [priority, setPriority] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(() => params.get("new") === "1");
  const [editing, setEditing] = React.useState<Task | null>(null);
  const [deleting, setDeleting] = React.useState<Task | null>(null);
  const { data: categories } = useTaskCategories();
  const { data, isPending, isError, error, refetch, isFetching } = useTasks(view, {
    search: debouncedSearch || undefined,
    priority: priority || undefined,
    category: category || undefined,
  });
  const { remove } = useTaskMutations();

  React.useEffect(() => {
    if (params.get("new") === "1") setParams({}, { replace: true });
  }, [params, setParams]);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const filtered = Boolean(debouncedSearch || priority || category);
  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (task: Task) => {
    setEditing(task);
    setFormOpen(true);
  };

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Tasks"
        description="Plan your day and keep track of what's pending."
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden /> Add task
          </Button>
        }
      />

      <PendingTasksCard onEdit={openEdit} />

      <div className="grid grid-cols-1 gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as TaskView)}>
          <div className="overflow-x-auto [scrollbar-width:none]">
            <TabsList aria-label="Task views" className="w-max sm:w-auto">
              {VIEWS.map((v) => (
                <TabsTrigger key={v.value} value={v.value}>
                  {v.label}
                  {data && <span className="tabular-nums text-muted-foreground">{data.counts[v.value]}</span>}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]" role="search" aria-label="Filter tasks">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" aria-label="Search tasks" placeholder="Search tasks…" className="pl-9" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <NativeSelect aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">All priorities</option>
            {Object.entries(TASK_PRIORITY).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories?.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <span>Couldn't load tasks. {getErrorMessage(error)}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : isPending ? (
        <div className="grid gap-2" aria-label="Loading tasks">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        filtered ? (
          <EmptyState icon={SearchX} title="No matching tasks" description="Try a different search or filter." />
        ) : (
          <EmptyState icon={ListChecks} title={EMPTY_TEXT[view]} description={view === "all" ? "Add your first task to get started." : "Switch views to see other tasks."}>
            {view !== "completed" && (
              <Button onClick={openCreate}>
                <Plus aria-hidden /> Add task
              </Button>
            )}
          </EmptyState>
        )
      ) : (
        <ul className={cn("grid grid-cols-1 gap-2", isFetching && "opacity-70")} aria-label="Tasks">
          {data.items.map((task) => (
            <TaskRow key={task.id} task={task} onEdit={() => openEdit(task)} onDelete={() => setDeleting(task)} />
          ))}
        </ul>
      )}

      <TaskFormDialog open={formOpen} onOpenChange={setFormOpen} task={editing} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete “${deleting?.title}”?`}
        description="This task will be permanently deleted."
        confirmLabel="Delete task"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Task deleted.");
              setDeleting(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
