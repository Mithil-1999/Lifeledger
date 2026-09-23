import * as React from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ServerCrash } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { UNAUTHORIZED_EVENT } from "@/lib/api";
import { safeRedirectPath } from "./redirect";
import { AUTH_QUERY_KEY, useCurrentUser } from "./use-auth";

function FullPageLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading LifeVault">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
    </div>
  );
}

function ServerUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <EmptyState
        icon={ServerCrash}
        title="Can't reach LifeVault"
        description="The server isn't responding. Make sure the backend is running, then try again."
      >
        <Button onClick={onRetry}>Try again</Button>
      </EmptyState>
    </div>
  );
}

/** Ends the local session when any API call reports 401 (expired or revoked session). */
function SessionWatcher() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  React.useEffect(() => {
    const onUnauthorized = () => {
      queryClient.clear();
      queryClient.setQueryData(AUTH_QUERY_KEY, null);
      toast.info("Your session has ended. Please sign in again.");
      navigate("/login", { replace: true, state: { from: location.pathname + location.search } });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [queryClient, navigate, location.pathname, location.search]);

  return null;
}

/** Wraps every application page: unauthenticated visitors are sent to /login. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data: user, isPending, isError, refetch } = useCurrentUser();
  const location = useLocation();

  if (isPending) return <FullPageLoader />;
  if (isError) return <ServerUnavailable onRetry={() => void refetch()} />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return (
    <>
      <SessionWatcher />
      {children}
    </>
  );
}

/** For login/register/forgot-password: signed-in users go straight to the app. */
export function PublicOnly() {
  const { data: user, isPending } = useCurrentUser();
  const location = useLocation();

  if (isPending) return <FullPageLoader />;
  if (user) {
    const from = (location.state as { from?: unknown } | null)?.from;
    return <Navigate to={safeRedirectPath(from)} replace />;
  }
  return <Outlet />;
}
