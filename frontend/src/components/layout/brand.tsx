import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <ShieldCheck className="size-4.5" aria-hidden />
      </span>
      {!collapsed && (
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight text-foreground">LifeVault</span>
          <span className="text-[11px] text-muted-foreground">Personal life manager</span>
        </span>
      )}
    </div>
  );
}
