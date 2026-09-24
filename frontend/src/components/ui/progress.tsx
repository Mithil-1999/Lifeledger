import { cn } from "@/lib/utils";

interface ProgressProps {
  /** 0-100+; values above 100 fill the bar. */
  value: number;
  label: string;
  tone?: "default" | "success" | "warning" | "destructive";
  className?: string;
}

/** Accessible progress bar (role="progressbar" with a readable label and value). */
export function Progress({ value, label, tone = "default", className }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-valuetext={`${value}%`}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "default" && "bg-primary",
          tone === "success" && "bg-success",
          tone === "warning" && "bg-warning",
          tone === "destructive" && "bg-destructive",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
