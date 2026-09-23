import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, children, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/50 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="size-6" aria-hidden />
      </span>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {children && <div className="mt-5 w-full max-w-md">{children}</div>}
    </div>
  );
}
