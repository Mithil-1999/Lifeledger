import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, type Money } from "@/lib/format";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  icon: LucideIcon;
  value: Money | null | undefined;
  loading?: boolean;
  /** Shown instead of a number when there is no data (never a made-up value). */
  emptyHint?: string;
  tone?: "default" | "positive" | "negative";
}

/** One headline figure. With no value it shows an explicit "no data" state. */
export function StatCard({ label, icon: Icon, value, loading, emptyHint = "No data yet", tone = "default" }: StatCardProps) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            tone === "positive" && "bg-success/15 text-success",
            tone === "negative" && "bg-destructive/12 text-destructive",
            tone === "default" && "bg-accent text-accent-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      {loading ? (
        <Skeleton className="h-7 w-28" />
      ) : value ? (
        <p className="text-xl font-semibold tabular-nums tracking-tight text-foreground sm:text-2xl">{formatMoney(value)}</p>
      ) : (
        <div>
          <p className="text-xl font-semibold text-muted-foreground/60 sm:text-2xl" aria-hidden>
            —
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="sr-only">{label}: </span>
            {emptyHint}
          </p>
        </div>
      )}
    </Card>
  );
}
