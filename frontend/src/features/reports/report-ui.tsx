import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { ChartCard } from "@/components/charts/chart-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Change } from "./api";
import { isNegative, isZero, money } from "./format";


/** Change vs. a previous value. `upIsGood` decides the colour (more income = good, more spending = bad). */
export function ChangeText({ change, currency, upIsGood = false, className }: { change: Change | null; currency: string; upIsGood?: boolean; className?: string }) {
  if (!change) return <span className={cn("text-muted-foreground", className)}>—</span>;
  const zero = isZero(change.amount);
  const down = isNegative(change.amount);
  const Icon = zero ? Minus : down ? ArrowDownRight : ArrowUpRight;
  const good = zero ? null : down !== upIsGood;
  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", good === true && "text-success", good === false && "text-destructive", zero && "text-muted-foreground", className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>
        {zero ? "No change" : `${down ? "" : "+"}${money(change.amount, currency)}`}
        {!zero && change.percent !== null && ` (${down ? "" : "+"}${change.percent}%)`}
      </span>
    </span>
  );
}

/** Headline figure: a value (already formatted) plus an optional line underneath. */
export function Figure({ label, value, hint, tone = "default" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "positive" | "negative" | "muted" }) {
  const id = React.useId();
  return (
    <Card role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-1 p-4">
      <span id={id} className="text-sm font-medium text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "truncate text-xl font-semibold tabular-nums tracking-tight sm:text-2xl",
          tone === "positive" && "text-success",
          tone === "negative" && "text-destructive",
          tone === "muted" && "text-muted-foreground/70",
        )}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </Card>
  );
}

export function FigureGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export function Section({ title, description, children, action }: { title: string; description?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right";
}

/** Accessible table that scrolls sideways inside its card on small screens (never the page). */
export function DataTable<T>({ caption, columns, rows, rowKey, empty = "Nothing to show.", footer }: { caption: string; columns: Column<T>[]; rows: T[]; rowKey: (row: T, index: number) => string; empty?: string; footer?: React.ReactNode[] }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className="w-full min-w-max text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {columns.map((c) => (
              <th key={c.header} scope="col" className={cn("px-2 py-2 font-medium", c.align === "right" && "text-right")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-b last:border-0">
              {columns.map((c, j) => {
                const Cell = j === 0 ? "th" : "td";
                return (
                  <Cell key={c.header} scope={j === 0 ? "row" : undefined} className={cn("px-2 py-2 align-top", j === 0 && "text-left font-medium", c.align === "right" && "text-right tabular-nums")}>
                    {c.cell(row)}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="border-t font-semibold">
              {footer.map((cell, i) => (
                <td key={i} className={cn("px-2 py-2", i > 0 && "text-right tabular-nums")}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Lazily loaded chart inside a ChartCard (Recharts is a separate chunk). */
export function LazyChart({ title, description, empty, emptyTitle, emptyDescription, children }: { title: string; description?: string; empty: boolean; emptyTitle?: string; emptyDescription?: string; children: React.ReactNode }) {
  return (
    <React.Suspense fallback={<ChartCard title={title} description={description} state="loading" />}>
      <ChartCard title={title} description={description} state={empty ? "empty" : "ready"} emptyTitle={emptyTitle} emptyDescription={emptyDescription}>
        {children}
      </ChartCard>
    </React.Suspense>
  );
}

export function ReportSkeleton() {
  return (
    <div className="grid gap-4" aria-label="Loading report">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
