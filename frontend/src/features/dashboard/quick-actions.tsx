import { Link } from "react-router";
import { BellPlus, CirclePlus, ListPlus, ReceiptText, TrendingUp, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QuickAction {
  label: string;
  icon: LucideIcon;
  /** Module page the action belongs to; `?new=1` opens its "add" form straight away. */
  modulePath: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Add income", icon: TrendingUp, modulePath: "/income" },
  { label: "Add expense", icon: CirclePlus, modulePath: "/expenses" },
  { label: "Add task", icon: ListPlus, modulePath: "/tasks" },
  { label: "Add reminder", icon: BellPlus, modulePath: "/reminders" },
  { label: "Add bill", icon: ReceiptText, modulePath: "/bills" },
];

export function QuickActions() {
  return (
    <section aria-labelledby="quick-actions-heading">
      <h2 id="quick-actions-heading" className="sr-only">
        Quick actions
      </h2>
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <Button key={action.label} variant="outline" className="shrink-0 bg-card" asChild>
              <Link to={`${action.modulePath}?new=1`}>
                <Icon className="text-primary" aria-hidden />
                {action.label}
              </Link>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
