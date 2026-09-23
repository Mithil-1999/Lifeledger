import { CircleDashed } from "lucide-react";
import { findNavItem } from "@/config/navigation";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";

/**
 * Layout-only placeholder for modules whose functionality is built in a later phase.
 * Reads title/description/plan from the navigation config so everything stays in sync.
 */
export function ModulePlaceholder({ path }: { path: string }) {
  const item = findNavItem(path);
  if (!item) return null;

  return (
    <>
      <PageHeader
        title={item.title}
        description={item.description}
        actions={
          <Badge variant="outline">
            <CircleDashed aria-hidden /> Planned · Phase {item.phase}
          </Badge>
        }
      />
      <EmptyState
        icon={item.icon}
        title={`${item.title} is coming soon`}
        description="This section is part of the navigation foundation. Its features will be built in a later phase."
      >
        <ul className="grid gap-2 text-left text-sm">
          {item.planned.map((feature) => (
            <li key={feature} className="flex items-start gap-2 rounded-lg border bg-background px-3 py-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              <span className="text-muted-foreground">{feature}</span>
            </li>
          ))}
        </ul>
      </EmptyState>
    </>
  );
}
