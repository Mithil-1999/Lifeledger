import { BellRing } from "lucide-react";
import type { DashboardSummary } from "./api";
import { ItemList, Panel, PanelEmpty, PanelSkeleton } from "./panel";

const timeFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function RemindersPanel({ reminders, loading }: { reminders?: DashboardSummary["reminders"]; loading: boolean }) {
  const unavailable = reminders && !reminders.available;
  return (
    <Panel title="Upcoming reminders" icon={BellRing} href="/reminders" comingInPhase={unavailable ? reminders.available_from_phase : null}>
      {loading || !reminders ? (
        <PanelSkeleton />
      ) : !reminders.available ? (
        <PanelEmpty
          icon={BellRing}
          title="Reminders will appear here"
          description={`One-time and recurring reminders arrive in Phase ${reminders.available_from_phase}.`}
        />
      ) : reminders.upcoming.length === 0 ? (
        <PanelEmpty icon={BellRing} title="No upcoming reminders" description="You're all set for now." />
      ) : (
        <ItemList
          items={reminders.upcoming}
          render={(reminder) => (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
              <span className="truncate">{reminder.title}</span>
              <time dateTime={reminder.remind_at} className="shrink-0 text-xs text-muted-foreground">
                {timeFormat.format(new Date(reminder.remind_at))}
              </time>
            </div>
          )}
        />
      )}
    </Panel>
  );
}
