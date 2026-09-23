import { isRouteErrorResponse, useRouteError } from "react-router";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

/** Friendly fallback when a route throws while rendering. Details stay in the console only. */
export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : "An unexpected error occurred.";

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <EmptyState icon={AlertTriangle} title="Something went wrong" description={message}>
        <Button onClick={() => window.location.assign("/dashboard")}>Reload LifeVault</Button>
      </EmptyState>
    </div>
  );
}
