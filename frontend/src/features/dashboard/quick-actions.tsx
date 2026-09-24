import * as React from "react";
import { Link } from "react-router";
import { BellPlus, CirclePlus, Construction, ListPlus, ReceiptText, TrendingUp, type LucideIcon } from "lucide-react";
import { findNavItem } from "@/config/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface QuickAction {
  label: string;
  icon: LucideIcon;
  /** Module page the action belongs to. */
  modulePath: string;
  /** Set when the create form exists; until then the action explains it's coming. */
  implemented: boolean;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Add income", icon: TrendingUp, modulePath: "/income", implemented: false },
  { label: "Add expense", icon: CirclePlus, modulePath: "/expenses", implemented: false },
  { label: "Add task", icon: ListPlus, modulePath: "/tasks", implemented: false },
  { label: "Add reminder", icon: BellPlus, modulePath: "/reminders", implemented: false },
  { label: "Add bill", icon: ReceiptText, modulePath: "/bills", implemented: false },
];

function ComingSoonDialog({ action, onOpenChange }: { action: QuickAction | null; onOpenChange: (open: boolean) => void }) {
  const module = action ? findNavItem(action.modulePath) : undefined;
  return (
    <Dialog open={action !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {action && module && (
          <>
            <DialogHeader>
              <span className="mb-1 flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Construction className="size-5" aria-hidden />
              </span>
              <DialogTitle>{action.label}: coming in Phase {module.phase}</DialogTitle>
              <DialogDescription>
                {module.title} isn't built yet, so nothing can be saved here. It will be available in a future phase.
              </DialogDescription>
            </DialogHeader>
            <ul className="grid gap-1.5 text-sm text-muted-foreground">
              {module.planned.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  {feature}
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" asChild>
                <Link to={module.path} onClick={() => onOpenChange(false)}>
                  Open {module.title}
                </Link>
              </Button>
              <Button onClick={() => onOpenChange(false)}>Got it</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function QuickActions() {
  const [pending, setPending] = React.useState<QuickAction | null>(null);

  return (
    <section aria-labelledby="quick-actions-heading">
      <h2 id="quick-actions-heading" className="sr-only">
        Quick actions
      </h2>
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <Button key={action.label} variant="outline" className="shrink-0 bg-card" onClick={() => setPending(action)}>
              <Icon className="text-primary" aria-hidden />
              {action.label}
            </Button>
          );
        })}
      </div>
      <ComingSoonDialog action={pending} onOpenChange={(open) => !open && setPending(null)} />
    </section>
  );
}
