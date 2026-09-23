import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useHealth } from "./use-health";

/** Small dot in the top bar showing whether the API and database are reachable. */
export function ApiStatusIndicator() {
  const { data, isPending, isError } = useHealth();

  const state = isPending ? "checking" : isError ? "offline" : data?.status === "ok" ? "online" : "degraded";
  const label = {
    checking: "Checking API connection…",
    online: "API and database connected",
    degraded: "API reachable, database unavailable",
    offline: "Cannot reach the API",
  }[state];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="status" aria-label={label} className="mr-1 hidden items-center gap-2 rounded-full border px-2.5 py-1 text-xs text-muted-foreground sm:inline-flex">
          <span
            className={cn(
              "size-2 rounded-full",
              state === "online" && "bg-success",
              state === "degraded" && "bg-warning",
              state === "offline" && "bg-destructive",
              state === "checking" && "animate-pulse bg-muted-foreground",
            )}
          />
          {state === "online" ? "Online" : state === "checking" ? "Connecting" : state === "degraded" ? "Degraded" : "Offline"}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
