import * as React from "react";
import { Link } from "react-router";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface PanelProps {
  title: string;
  icon: LucideIcon;
  href: string;
  /** Phase that builds this module, when it doesn't exist yet. */
  comingInPhase?: number | null;
  children: React.ReactNode;
}

/** Dashboard panel: titled card with a link to the full module page. */
export function Panel({ title, icon: Icon, href, comingInPhase, children }: PanelProps) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-primary" aria-hidden />
          {title}
        </CardTitle>
        {comingInPhase ? (
          <Badge variant="outline">Phase {comingInPhase}</Badge>
        ) : (
          <Link to={href} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            View all <ArrowRight className="size-3" aria-hidden />
          </Link>
        )}
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
    </Card>
  );
}

/** Compact empty state used inside dashboard panels. */
export function PanelEmpty({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed bg-muted/30 px-4 py-7 text-center">
      <Icon className="size-5 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export function PanelSkeleton() {
  return (
    <div className="grid gap-2" aria-hidden>
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  );
}

export function ItemList<T>({ items, render }: { items: T[]; render: (item: T) => React.ReactNode }) {
  return <ul className="grid gap-2">{items.map((item, i) => <li key={i}>{render(item)}</li>)}</ul>;
}
