import * as React from "react";
import { Link } from "react-router";
import { AlertCircle, Bell, BellOff, CheckCheck, Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNotificationMutations, useNotifications, usePreferences, type AppNotification, type NotificationPreferences, type NotificationType } from "@/features/notifications/api";
import { browserSupport, requestBrowserPermission, showBrowserNotification, type BrowserPermission } from "@/features/notifications/browser";
import { NotificationIcon } from "@/features/notifications/notification-bell";
import { DEFAULT_PREFERENCES, NOTIFICATION_TYPES, RELATED_LINKS, TYPE_ORDER, timeAgo } from "@/features/notifications/constants";
import { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

// --- List -----------------------------------------------------------------------------------------------------

function NotificationRow({ n }: { n: AppNotification }) {
  const { setRead, dismiss } = useNotificationMutations();
  const link = RELATED_LINKS[n.related_type];
  const fail = (e: unknown) => toast.error(getErrorMessage(e));
  return (
    <li className={cn("flex min-w-0 items-start gap-3 rounded-xl border bg-card p-3", !n.is_read && "border-primary/40 bg-primary/[0.03]")}>
      <NotificationIcon notification={n} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("min-w-0 break-words text-sm", !n.is_read && "font-semibold")}>{n.title}</span>
          {!n.is_read && <Badge>New</Badge>}
        </div>
        <p className="mt-0.5 break-words text-sm text-muted-foreground">{n.message}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <time dateTime={n.created_at} title={new Date(n.created_at).toLocaleString()}>
            {timeAgo(n.created_at)}
          </time>
          <span aria-hidden>·</span>
          <span>{NOTIFICATION_TYPES[n.type].label}</span>
          <span aria-hidden>·</span>
          <Link to={link.path} className="font-medium text-primary hover:underline" onClick={() => !n.is_read && setRead.mutate({ id: n.id, read: true })}>
            {link.label}
          </Link>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${n.title}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRead.mutate({ id: n.id, read: !n.is_read }, { onError: fail })}>
            <CheckCheck /> Mark as {n.is_read ? "unread" : "read"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => dismiss.mutate(n.id, { onError: fail })} className="text-destructive data-[highlighted]:text-destructive">
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function NotificationList() {
  const [status, setStatus] = React.useState<"all" | "unread">("all");
  const [type, setType] = React.useState<NotificationType | "">("");
  const [limit, setLimit] = React.useState(PAGE_SIZE);
  const { data, isPending, isError, error, refetch, isFetching } = useNotifications({ status, type: type || undefined, limit });
  const { readAll, dismissRead } = useNotificationMutations();

  return (
    <section aria-labelledby="notification-list-heading" className="grid min-w-0 grid-cols-1 gap-3">
      <h2 id="notification-list-heading" className="sr-only">
        Notification list
      </h2>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={status} onValueChange={(v) => { setStatus(v as "all" | "unread"); setLimit(PAGE_SIZE); }}>
          <TabsList aria-label="Show">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">
              Unread {data && <span className="tabular-nums text-muted-foreground">{data.unread_count}</span>}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
          <NativeSelect aria-label="Notification type" value={type} onChange={(e) => { setType(e.target.value as NotificationType | ""); setLimit(PAGE_SIZE); }}>
            <option value="">All types</option>
            {TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {NOTIFICATION_TYPES[t].label}
              </option>
            ))}
          </NativeSelect>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!data?.unread_count || readAll.isPending} onClick={() => readAll.mutate(undefined, { onSuccess: (r) => toast.success(`Marked ${r.count} as read.`) })}>
              <CheckCheck aria-hidden /> Mark all read
            </Button>
            <Button variant="outline" size="sm" disabled={dismissRead.isPending} onClick={() => dismissRead.mutate(undefined, { onSuccess: (r) => toast.success(r.count ? `Deleted ${r.count} read notification${r.count === 1 ? "" : "s"}.` : "No read notifications to delete.") })}>
              <Trash2 aria-hidden /> Delete read
            </Button>
          </div>
        </div>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <span>Couldn't load notifications. {getErrorMessage(error)}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : isPending ? (
        <div className="grid gap-2" aria-label="Loading notifications">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={status === "unread" ? "No unread notifications" : "No notifications yet"}
          description="You'll be notified about overdue and upcoming tasks and bills, budget alerts, savings milestones and reminders."
        />
      ) : (
        <>
          <ul className={cn("grid grid-cols-1 gap-2", isFetching && "opacity-70")} aria-label="Notifications">
            {data.items.map((n) => (
              <NotificationRow key={n.id} n={n} />
            ))}
          </ul>
          {data.items.length < data.total && (
            <Button variant="outline" className="justify-self-center" onClick={() => setLimit((l) => Math.min(100, l + PAGE_SIZE))} disabled={limit >= 100}>
              {limit >= 100 ? "Showing the latest 100" : `Show more (${data.total - data.items.length} more)`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

// --- Preferences ----------------------------------------------------------------------------------------------

const PERMISSION_TEXT: Record<BrowserPermission, string> = {
  granted: "Allowed in this browser.",
  denied: "Blocked in this browser. Allow notifications for this site in your browser settings to use them.",
  default: "Your browser will ask for permission when you turn this on.",
  unsupported: "This browser doesn't support notifications. You'll still see them here in LifeVault.",
};

function PreferencesForm({ initial }: { initial: NotificationPreferences }) {
  const [prefs, setPrefs] = React.useState(initial);
  const [permission, setPermission] = React.useState<BrowserPermission>(() => browserSupport());
  const { savePreferences } = useNotificationMutations();
  const dirty = JSON.stringify(prefs) !== JSON.stringify(initial);
  const set = <K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) => setPrefs((p) => ({ ...p, [key]: value }));

  const toggleBrowser = async (on: boolean) => {
    if (!on) return set("browser_enabled", false);
    const result = await requestBrowserPermission();
    setPermission(result);
    if (result === "granted") set("browser_enabled", true);
    else toast.error(result === "unsupported" ? "This browser doesn't support notifications." : "Notifications are blocked for this site in your browser.");
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    savePreferences.mutate(prefs, {
      onSuccess: () => toast.success("Notification settings saved."),
      onError: (err) => toast.error(getErrorMessage(err)),
    });
  };

  return (
    <form onSubmit={save} className="grid gap-5">
      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-medium">Notify me about</legend>
        {TYPE_ORDER.map((t) => (
          <label key={t} className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={prefs[t]} onChange={(e) => set(t, e.target.checked)} />
            <span>
              <span className="font-medium">{NOTIFICATION_TYPES[t].label}</span>
              <span className="block text-xs text-muted-foreground">{NOTIFICATION_TYPES[t].description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="task-lead">Upcoming tasks</Label>
          <NativeSelect id="task-lead" value={prefs.task_lead_days} disabled={!prefs.task_upcoming} onChange={(e) => set("task_lead_days", Number(e.target.value))}>
            {[0, 1, 2, 3, 7, 14].map((d) => (
              <option key={d} value={d}>
                {d === 0 ? "On the due date" : `${d} day${d === 1 ? "" : "s"} before`}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bill-lead">Upcoming bills</Label>
          <NativeSelect id="bill-lead" value={prefs.bill_lead_days} disabled={!prefs.bill_upcoming} onChange={(e) => set("bill_lead_days", Number(e.target.value))}>
            {[0, 1, 3, 5, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d === 0 ? "On the due date" : `${d} day${d === 1 ? "" : "s"} before`}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <fieldset className="grid gap-2 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Browser notifications</legend>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            checked={prefs.browser_enabled}
            disabled={permission === "unsupported"}
            onChange={(e) => void toggleBrowser(e.target.checked)}
          />
          <span>
            <span className="font-medium">Show system notifications while LifeVault is open</span>
            <span className="block text-xs text-muted-foreground">{PERMISSION_TEXT[permission]}</span>
          </span>
        </label>
        {prefs.browser_enabled && permission === "granted" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => showBrowserNotification("LifeVault test notification", "Browser notifications are working.", "lifevault-test") || toast.error("This browser didn't show the notification.")}
          >
            Send a test notification
          </Button>
        )}
        <p className="text-xs text-muted-foreground">Notification text can appear on your lock screen. Turn this off on shared devices.</p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!dirty || savePreferences.isPending}>
          {savePreferences.isPending && <Loader2 className="animate-spin" aria-hidden />} Save settings
        </Button>
        {dirty && (
          <Button type="button" variant="ghost" onClick={() => setPrefs(initial)}>
            Discard changes
          </Button>
        )}
      </div>
    </form>
  );
}

function PreferencesCard() {
  const { data, isPending, isError, error } = usePreferences();
  const initial: NotificationPreferences | null = data
    ? Object.fromEntries(Object.keys(DEFAULT_PREFERENCES).map((k) => [k, data[k as keyof NotificationPreferences]])) as unknown as NotificationPreferences
    : null;
  return (
    <Card className="min-w-0 self-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellOff className="size-4" aria-hidden /> Notification settings
        </CardTitle>
        <CardDescription>Choose what LifeVault tells you about. Checks run automatically every few minutes.</CardDescription>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="text-sm text-destructive">Couldn't load settings. {getErrorMessage(error)}</p>
        ) : isPending || !initial ? (
          <Skeleton className="h-72" />
        ) : (
          <PreferencesForm key={data.updated_at} initial={initial} />
        )}
      </CardContent>
    </Card>
  );
}

export function NotificationsPage() {
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Notifications" description="Overdue and upcoming tasks and bills, budget alerts, savings milestones and reminders." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <NotificationList />
        <PreferencesCard />
      </div>
    </div>
  );
}
