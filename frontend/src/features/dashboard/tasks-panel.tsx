import { CalendarCheck, CircleAlert, ListChecks, ListTodo } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/format";
import type { DashboardSummary, TaskItem } from "./api";
import { ItemList, Panel, PanelEmpty, PanelSkeleton } from "./panel";

const TABS = [
  { value: "today", label: "Today", icon: CalendarCheck, empty: "Nothing due today." },
  { value: "pending", label: "Not started", icon: ListTodo, empty: "Nothing waiting to be started." },
  { value: "overdue", label: "Overdue", icon: CircleAlert, empty: "Nothing overdue." },
] as const;

const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-destructive",
  high: "bg-warning",
  medium: "bg-primary",
  low: "bg-muted-foreground/50",
};

function TaskRow({ task }: { task: TaskItem }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        {task.priority && (
          <span className={`size-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority] ?? "bg-muted"}`} title={`${task.priority} priority`} aria-hidden />
        )}
        <span className="truncate">{task.title}</span>
        {task.priority && <span className="sr-only">({task.priority} priority)</span>}
      </span>
      {task.due_date && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDate(task.due_date, { day: "numeric", month: "short" })}
          {task.due_time ? ` ${task.due_time.slice(0, 5)}` : ""}
        </span>
      )}
    </div>
  );
}

export function TasksPanel({ tasks, loading }: { tasks?: DashboardSummary["tasks"]; loading: boolean }) {
  const unavailable = tasks && !tasks.available;
  return (
    <Panel title="Tasks" icon={ListChecks} href="/tasks" comingInPhase={unavailable ? tasks.available_from_phase : null}>
      <Tabs defaultValue="today">
        <TabsList aria-label="Task views">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
              {tasks?.available && (
                <span className="tabular-nums text-muted-foreground">{tasks.counts?.[tab.value] ?? tasks[tab.value].length}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {loading || !tasks ? (
              <PanelSkeleton />
            ) : !tasks.available ? (
              <PanelEmpty
                icon={tab.icon}
                title={`${tab.label} tasks will appear here`}
                description={`The task system arrives in Phase ${tasks.available_from_phase}.`}
              />
            ) : tasks[tab.value].length === 0 ? (
              <PanelEmpty icon={tab.icon} title={tab.empty} description="You're all caught up." />
            ) : (
              <ItemList items={tasks[tab.value]} render={(task) => <TaskRow task={task} />} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </Panel>
  );
}
