import { AlertTriangle, CheckCircle2, Database, RefreshCw, Server, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useHealth } from "./use-health";

function StatusRow({ icon: Icon, label, ok, value }: { icon: typeof Server; label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" aria-hidden /> {label}
      </span>
      <Badge variant={ok ? "success" : "destructive"}>
        {ok ? <CheckCircle2 aria-hidden /> : <XCircle aria-hidden />} {value}
      </Badge>
    </div>
  );
}

/** Shows live backend/database connectivity from GET /api/health. */
export function SystemStatusCard() {
  const { data, isPending, isError, refetch, isFetching } = useHealth();

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle>System status</CardTitle>
          <CardDescription>Live connection to the LifeVault API and database.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "animate-spin" : undefined} aria-hidden />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="grid gap-2" aria-live="polite">
        {isPending ? (
          <>
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </>
        ) : isError ? (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <div>
              <p className="font-medium text-foreground">Cannot reach the API</p>
              <p className="text-muted-foreground">Make sure the backend is running on port 8000, then refresh.</p>
            </div>
          </div>
        ) : (
          <>
            <StatusRow icon={Server} label="API" ok value={`v${data.version} · ${data.environment}`} />
            <StatusRow
              icon={Database}
              label="PostgreSQL"
              ok={data.database === "ok"}
              value={data.database === "ok" ? "Connected" : "Unavailable"}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
