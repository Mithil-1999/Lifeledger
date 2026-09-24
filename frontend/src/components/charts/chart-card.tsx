import * as React from "react";
import { ChartNoAxesColumn, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export type ChartState = "loading" | "empty" | "ready";

interface ChartCardProps {
  title: string;
  description?: string;
  state: ChartState;
  /** Shown when there's no data yet. */
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
  className?: string;
  children?: React.ReactNode;
}

/** Card frame shared by every chart: consistent header plus loading and empty states. */
export function ChartCard({
  title,
  description,
  state,
  emptyTitle = "No data yet",
  emptyDescription,
  emptyIcon: EmptyIcon = ChartNoAxesColumn,
  className,
  children,
}: ChartCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {state === "loading" && <Skeleton className="h-56 w-full" />}
        {state === "empty" && (
          <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 px-6 text-center">
            <EmptyIcon className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
            {emptyDescription && <p className="max-w-xs text-xs text-muted-foreground">{emptyDescription}</p>}
          </div>
        )}
        {state === "ready" && children}
      </CardContent>
    </Card>
  );
}
