import * as React from "react";
import { Link, useNavigate } from "react-router";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useNotificationMutations, useNotifications, usePreferences, type AppNotification } from "./api";
import { showBrowserNotification } from "./browser";
import { NOTIFICATION_TYPES, RELATED_LINKS, TONE_CLASSES, timeAgo } from "./constants";

/** Ask the server to run the checks now and then (the background job also runs them). */
const CHECK_EVERY_MS = 5 * 60_000;

export function NotificationIcon({ notification, className }: { notification: AppNotification; className?: string }) {
  const meta = NOTIFICATION_TYPES[notification.type];
  const Icon = meta.icon;
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", TONE_CLASSES[meta.tone], className)}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

/** Shows a system notification for each new unread notification, once, while the app is open. */
function useBrowserAlerts(items: AppNotification[] | undefined, enabled: boolean) {
  const seen = React.useRef<Set<string> | null>(null);
  const navigate = useNavigate();
  React.useEffect(() => {
    if (!items) return;
    // Notifications that already existed when the app opened are not re-announced.
    if (seen.current === null) {
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    for (const n of items) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (enabled && !n.is_read) showBrowserNotification(n.title, n.message, `lifevault-${n.id}`, () => navigate(RELATED_LINKS[n.related_type].path));
    }
  }, [items, enabled, navigate]);
}

export function NotificationBell() {
  const navigate = useNavigate();
  const { data } = useNotifications({ status: "all", limit: 8 }, { poll: true });
  const { data: prefs } = usePreferences();
  const { setRead, readAll, check } = useNotificationMutations();
  const runCheck = check.mutate;

  React.useEffect(() => {
    runCheck();
    const timer = window.setInterval(() => runCheck(), CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [runCheck]);

  useBrowserAlerts(data?.items, Boolean(prefs?.browser_enabled));

  const unread = data?.unread_count ?? 0;
  const open = (n: AppNotification) => {
    if (!n.is_read) setRead.mutate({ id: n.id, read: true });
    navigate(RELATED_LINKS[n.related_type].path);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white" aria-hidden>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => readAll.mutate()}>
              <CheckCheck aria-hidden /> Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator className="my-0" />
        <div className="max-h-96 overflow-y-auto py-1">
          {!data || data.items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
          ) : (
            data.items.map((n) => (
              <DropdownMenuItem key={n.id} onSelect={() => open(n)} className="mx-1 items-start gap-3 whitespace-normal px-2 py-2">
                <NotificationIcon notification={n} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm leading-snug", !n.is_read && "font-semibold")}>{n.title}</span>
                  <span className="line-clamp-2 block text-xs text-muted-foreground">{n.message}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{timeAgo(n.created_at)}</span>
                </span>
                {!n.is_read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
              </DropdownMenuItem>
            ))
          )}
        </div>
        <DropdownMenuSeparator className="my-0" />
        <DropdownMenuItem asChild className="m-1 justify-center text-sm font-medium">
          <Link to="/notifications">View all and settings</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
