import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AlertCircle, ChevronRight, Download, Smartphone, KeyRound, Laptop, Loader2, LogOut, ShieldAlert, ShieldCheck, Trash2, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageHeader } from "@/components/common/page-header";
import { FormField } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
import { useTheme, type Theme } from "@/components/theme/theme-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useAccountMutations,
  useAccountPreferences,
  useBackupInfo,
  useSecurityActivity,
  useSessions,
  useTwoFactorStatus,
  type DateFormatPreference,
  type ExportScope,
} from "@/features/account/api";
import { Avatar } from "@/features/account/avatar";
import { SECURITY_EVENT_LABELS, dateTime, describeDevice, formatBytes } from "@/features/account/helpers";
import { useCurrentUser } from "@/features/auth/use-auth";
import type { User } from "@/features/auth/api";
import { getErrorMessage, getFieldError } from "@/lib/api";
import { promptInstall, useInstallState } from "@/lib/pwa";
import { cn } from "@/lib/utils";

type SettingsTab = "profile" | "security" | "preferences" | "data";
const TABS: { value: SettingsTab; label: string }[] = [
  { value: "profile", label: "Profile" },
  { value: "security", label: "Security" },
  { value: "preferences", label: "Preferences" },
  { value: "data", label: "Data" },
];

const fail = (e: unknown) => toast.error(getErrorMessage(e));

// --- Profile ------------------------------------------------------------------------------------------------------

function ProfilePicture({ user }: { user: User }) {
  const { uploadAvatar, removeAvatar } = useAccountMutations();
  const input = React.useRef<HTMLInputElement>(null);
  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast.error("Choose an image under 2 MB.");
    uploadAvatar.mutate(file, { onSuccess: () => toast.success("Profile picture updated."), onError: fail });
  };
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar user={user} className="size-20 text-2xl" />
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploadAvatar.isPending}>
            {uploadAvatar.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />} {user.has_avatar ? "Change picture" : "Upload picture"}
          </Button>
          {user.has_avatar && (
            <Button type="button" variant="ghost" size="sm" onClick={() => removeAvatar.mutate(undefined, { onSuccess: () => toast.success("Profile picture removed."), onError: fail })}>
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to 2 MB. Only you can see it.</p>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Profile picture file" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    </div>
  );
}

function ProfileForm({ user }: { user: User }) {
  const { updateProfile } = useAccountMutations();
  const [name, setName] = React.useState(user.name);
  const [username, setUsername] = React.useState(user.username);
  const [email, setEmail] = React.useState(user.email);
  const [password, setPassword] = React.useState("");
  const identityChanged = username.trim().toLowerCase() !== user.username || email.trim().toLowerCase() !== user.email;
  const dirty = identityChanged || name.trim() !== user.name;
  const fieldError = getFieldError(updateProfile.error);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Enter your name.");
    if (identityChanged && !password) return toast.error("Enter your current password to change your username or email.");
    updateProfile.mutate(
      { name: name.trim(), username: username.trim(), email: email.trim(), ...(identityChanged ? { current_password: password } : {}) },
      { onSuccess: () => { setPassword(""); toast.success("Profile saved."); } },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {updateProfile.isError && !fieldError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <span>{getErrorMessage(updateProfile.error)}</span>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="profile-name" label="Name">
          {(aria) => <Input {...aria} value={name} maxLength={100} autoComplete="name" onChange={(e) => setName(e.target.value)} />}
        </FormField>
        <FormField id="profile-username" label="Username">
          {(aria) => <Input {...aria} value={username} maxLength={32} autoComplete="username" onChange={(e) => setUsername(e.target.value)} />}
        </FormField>
      </div>
      <FormField id="profile-email" label="Email" hint="Used for password reset emails.">
        {(aria) => <Input {...aria} type="email" value={email} maxLength={254} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />}
      </FormField>
      {identityChanged && (
        <FormField id="profile-password" label="Current password" hint="Required to change your username or email.">
          {(aria) => <PasswordInput {...aria} value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />}
        </FormField>
      )}
      <div>
        <Button type="submit" disabled={!dirty || updateProfile.isPending}>
          {updateProfile.isPending && <Loader2 className="animate-spin" aria-hidden />} Save profile
        </Button>
      </div>
    </form>
  );
}

function ProfileTab({ user }: { user: User }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Member since {new Date(user.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <ProfilePicture user={user} />
        <ProfileForm key={`${user.name}|${user.username}|${user.email}`} user={user} />
      </CardContent>
    </Card>
  );
}

// --- Security --------------------------------------------------------------------------------------------------------

function SessionsCard() {
  const { data, isPending, isError, error } = useSessions();
  const { revokeSession, revokeOthers } = useAccountMutations();
  const [confirmOthers, setConfirmOthers] = React.useState(false);
  const others = data?.filter((s) => !s.current).length ?? 0;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>Devices signed in to your account.</CardDescription>
        </div>
        <Button variant="outline" size="sm" disabled={!others} onClick={() => setConfirmOthers(true)}>
          <LogOut aria-hidden /> Sign out other sessions
        </Button>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="text-sm text-destructive">{getErrorMessage(error)}</p>
        ) : isPending ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="grid gap-2" aria-label="Active sessions">
            {data.map((s) => (
              <li key={s.id} className="flex min-w-0 items-start gap-3 rounded-lg border p-3">
                <Laptop className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {describeDevice(s.user_agent)} {s.current && <Badge variant="success">This device</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {s.ip_address ?? "Unknown IP"} · last active {dateTime(s.last_seen_at)} · signed in {dateTime(s.created_at)}
                  </p>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" aria-label={`Sign out ${describeDevice(s.user_agent)}`} onClick={() => revokeSession.mutate(s.id, { onSuccess: () => toast.success("Session signed out."), onError: fail })}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title="Sign out all other sessions?"
        description={`${others} other session${others === 1 ? "" : "s"} will be signed out. This device stays signed in.`}
        confirmLabel="Sign out others"
        destructive
        pending={revokeOthers.isPending}
        onConfirm={() => revokeOthers.mutate(undefined, { onSuccess: (r) => { setConfirmOthers(false); toast.success(`Signed out ${r.count} session${r.count === 1 ? "" : "s"}.`); }, onError: fail })}
      />
    </Card>
  );
}

function ActivityCard() {
  const { data, isPending } = useSecurityActivity();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Security activity</CardTitle>
        <CardDescription>Recent sign-ins and account changes. LifeVault will never ask you for your password by email or message.</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24" />
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <ul className="grid gap-1.5 text-sm" aria-label="Security activity">
            {data.map((e) => (
              <li key={e.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 border-b py-1.5 last:border-0">
                <span className={cn("font-medium", e.event === "login_failed" && "text-destructive")}>
                  {SECURITY_EVENT_LABELS[e.event]}
                  {e.detail && <span className="font-normal text-muted-foreground"> · {e.detail}</span>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {dateTime(e.created_at)} · {describeDevice(e.user_agent)} · {e.ip_address ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SecurityTab() {
  const { data: twoFactor } = useTwoFactorStatus();
  return (
    <div className="grid gap-4">
      <Link to="/settings/password" className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <KeyRound className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Change password</span>
          <span className="block text-xs text-muted-foreground">Update your sign-in password and sign out other devices.</span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" aria-hidden /> Two-factor authentication
          </CardTitle>
          <CardDescription>
            {twoFactor?.available
              ? "Protect your account with a second step at sign-in."
              : "Not available yet. The design is ready (authenticator app codes plus one-time recovery codes) and documented in SECURITY.md."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Badge variant="outline">Status: {twoFactor?.enabled ? "On" : "Off"}</Badge>
        </CardContent>
      </Card>
      <SessionsCard />
      <ActivityCard />
    </div>
  );
}

// --- Preferences ----------------------------------------------------------------------------------------------------------

const DATE_FORMATS: { value: DateFormatPreference; label: string }[] = [
  { value: "default", label: "Thu, 24 Sep 2026" },
  { value: "dmy", label: "24/09/2026" },
  { value: "mdy", label: "09/24/2026" },
  { value: "iso", label: "2026-09-24" },
];

function PreferencesTab() {
  const { data, isPending } = useAccountPreferences();
  const { savePreferences } = useAccountMutations();
  const { theme, setTheme } = useTheme();
  if (isPending || !data) return <Skeleton className="h-64" />;
  const save = (changes: Partial<{ currency: string; date_format: DateFormatPreference }>) =>
    savePreferences.mutate({ currency: data.currency, date_format: data.date_format, ...changes }, { onSuccess: () => toast.success("Preferences saved."), onError: fail });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        <CardDescription>How LifeVault shows money, dates and colours.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="pref-currency">Currency</Label>
          <NativeSelect id="pref-currency" value={data.currency} disabled={data.supported_currencies.length < 2} onChange={(e) => save({ currency: e.target.value })}>
            {data.supported_currencies.map((c) => (
              <option key={c} value={c}>
                {c === "NPR" ? "NPR, Nepalese rupee" : c}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">All amounts are recorded in NPR. Other currencies aren't supported yet.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pref-date">Date format</Label>
          <NativeSelect id="pref-date" value={data.date_format} onChange={(e) => save({ date_format: e.target.value as DateFormatPreference })}>
            {DATE_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">Used for full dates across the app.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pref-timezone">Timezone</Label>
          <Input id="pref-timezone" value={data.timezone} readOnly aria-describedby="pref-timezone-hint" />
          <p id="pref-timezone-hint" className="text-xs text-muted-foreground">
            Set for this private server with APP_TIMEZONE. It decides “today”, due dates and month boundaries.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pref-theme">Theme</Label>
          <NativeSelect id="pref-theme" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            <option value="system">Match my device</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">Saved on this device.</p>
        </div>
        <Link to="/notifications" className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40 sm:col-span-2">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Notifications</span>
            <span className="block text-xs text-muted-foreground">Choose which notifications you get, how early, and browser notifications.</span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

function InstallAppCard() {
  const state = useInstallState();
  const install = async () => {
    if (await promptInstall()) toast.success("LifeVault is being installed.");
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-4" aria-hidden /> Install the app
        </CardTitle>
        <CardDescription>Add LifeVault to your phone or computer so it opens like a normal app, with its own icon and full screen.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {state.kind === "installed" ? (
          <p className="flex items-center gap-2 font-medium text-success">
            <ShieldCheck className="size-4" aria-hidden /> LifeVault is installed on this device.
          </p>
        ) : state.kind === "available" ? (
          <div>
            <Button onClick={() => void install()}>
              <Download aria-hidden /> Install LifeVault
            </Button>
          </div>
        ) : state.kind === "ios" ? (
          <ol className="grid list-decimal gap-1 pl-5">
            <li>Open LifeVault in <strong>Safari</strong>.</li>
            <li>Tap the <strong>Share</strong> button (the square with an arrow).</li>
            <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          </ol>
        ) : (
          <ol className="grid list-decimal gap-1 pl-5">
            <li>On Android, open LifeVault in <strong>Chrome</strong>. On a computer, use Chrome or Edge.</li>
            <li>Open the browser menu (⋮) and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
          </ol>
        )}
        <p className="text-xs text-muted-foreground">
          Installing needs the secure (https://) online version of LifeVault. Your data is never stored for offline use; the app always loads it fresh from your server.
        </p>
      </CardContent>
    </Card>
  );
}

// --- Data --------------------------------------------------------------------------------------------------------------------

const COUNT_LABELS: Record<string, string> = {
  incomes: "Income records",
  expenses: "Expenses",
  budgets: "Budgets",
  bills: "Bills",
  savings_goals: "Savings goals",
  tasks: "Tasks",
  reminders: "Reminders",
  calendar_events: "Calendar events",
  notes: "Notes",
  documents: "Documents",
  vault_entries: "Vault entries",
};

function ExportDialog({ scope, onClose }: { scope: ExportScope | null; onClose: () => void }) {
  const { exportData } = useAccountMutations();
  const [password, setPassword] = React.useState("");
  const label = scope === "financial" ? "financial data" : scope === "personal" ? "personal data" : "all your data";
  return (
    <Dialog open={scope !== null} onOpenChange={(open) => !open && !exportData.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export {label}</DialogTitle>
          <DialogDescription>The file contains private information. Store it somewhere safe. Vault passwords and uploaded files are not included.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!scope || !password) return;
            exportData.mutate({ scope, password }, { onSuccess: (name) => { toast.success(`Downloaded ${name}.`); onClose(); } });
          }}
        >
          {exportData.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(exportData.error)}</span>
            </Alert>
          )}
          <FormField id="export-password" label="Confirm your password">
            {(aria) => <PasswordInput {...aria} value={password} autoComplete="current-password" autoFocus onChange={(e) => setPassword(e.target.value)} />}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={exportData.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!password || exportData.isPending}>
              {exportData.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />} Download JSON
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { deleteAccount } = useAccountMutations();
  const navigate = useNavigate();
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const ready = confirmation === "DELETE" && password.length > 0;
  return (
    <Dialog open={open} onOpenChange={(next) => !deleteAccount.isPending && onOpenChange(next)}>
      <DialogContent role="alertdialog">
        <DialogHeader>
          <DialogTitle>Delete your account permanently?</DialogTitle>
          <DialogDescription>
            Everything is deleted: money records, budgets, bills, savings, tasks, reminders, calendar, notes, documents, vault entries and notifications. This can't be undone. Export your data first if you want a copy.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            deleteAccount.mutate({ password, confirmation }, { onSuccess: () => { toast.success("Your account has been deleted."); navigate("/login", { replace: true }); } });
          }}
        >
          {deleteAccount.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(deleteAccount.error)}</span>
            </Alert>
          )}
          <FormField id="delete-confirm" label="Type DELETE to confirm">
            {(aria) => <Input {...aria} value={confirmation} autoComplete="off" onChange={(e) => setConfirmation(e.target.value)} />}
          </FormField>
          <FormField id="delete-password" label="Your password">
            {(aria) => <PasswordInput {...aria} value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={deleteAccount.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!ready || deleteAccount.isPending}>
              {deleteAccount.isPending && <Loader2 className="animate-spin" aria-hidden />} Delete my account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DataTab() {
  const { data: backup, isPending } = useBackupInfo();
  const [exportScope, setExportScope] = React.useState<ExportScope | null>(null);
  const [exportKey, setExportKey] = React.useState(0);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteKey, setDeleteKey] = React.useState(0);
  const startExport = (scope: ExportScope) => {
    setExportKey((k) => k + 1);
    setExportScope(scope);
  };
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Export your data</CardTitle>
          <CardDescription>Download a JSON copy. Money amounts are exact. For spreadsheets, use the CSV exports on the Reports page.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          <Button variant="outline" onClick={() => startExport("financial")}>
            <Download aria-hidden /> Financial data
          </Button>
          <Button variant="outline" onClick={() => startExport("personal")}>
            <Download aria-hidden /> Personal data
          </Button>
          <Button onClick={() => startExport("all")}>
            <Download aria-hidden /> Everything
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backup information</CardTitle>
          <CardDescription>What your account holds. Full server backups are done by whoever runs LifeVault (see the deployment guide).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {isPending || !backup ? (
            <Skeleton className="h-32" />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                {Object.entries(backup.counts).map(([key, count]) => (
                  <div key={key} className="flex justify-between gap-2 border-b py-1">
                    <dt className="text-muted-foreground">{COUNT_LABELS[key] ?? key}</dt>
                    <dd className="font-medium tabular-nums">{count}</dd>
                  </div>
                ))}
              </dl>
              <ul className="grid gap-1 text-sm text-muted-foreground">
                <li>Document storage used: <span className="text-foreground">{formatBytes(backup.document_bytes)}</span></li>
                <li>Last export: <span className="text-foreground">{backup.last_export_at ? dateTime(backup.last_export_at) : "never"}</span></li>
                <li>App version {backup.app_version} · database schema {backup.database_revision ?? "unknown"}</li>
              </ul>
              <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                A complete backup needs three things: the PostgreSQL database, the document storage folder, and the vault master key (VAULT_MASTER_KEY), stored separately. Without the key, vault entries can't be decrypted.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="size-4" aria-hidden /> Delete account
          </CardTitle>
          <CardDescription>Permanently delete your account and all of its data, including stored files.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => { setDeleteKey((k) => k + 1); setDeleting(true); }}>
            <Trash2 aria-hidden /> Delete account…
          </Button>
        </CardContent>
      </Card>
      <ExportDialog key={`export-${exportKey}`} scope={exportScope} onClose={() => setExportScope(null)} />
      <DeleteAccountDialog key={`delete-${deleteKey}`} open={deleting} onOpenChange={setDeleting} />
    </div>
  );
}

// --- Page ------------------------------------------------------------------------------------------------------------------

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const { data: user } = useCurrentUser();
  const tab: SettingsTab = TABS.some((t) => t.value === params.get("tab")) ? (params.get("tab") as SettingsTab) : "profile";
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Settings" description="Your profile, security, preferences and data." />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <div className="overflow-x-auto [scrollbar-width:none]">
          <TabsList aria-label="Settings sections" className="w-max sm:w-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
      <div className="min-w-0 max-w-3xl">
        {!user ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserRound className="size-4" aria-hidden /> Loading…
          </div>
        ) : tab === "profile" ? (
          <ProfileTab user={user} />
        ) : tab === "security" ? (
          <SecurityTab />
        ) : tab === "preferences" ? (
          <div className="grid gap-4">
            <PreferencesTab />
            <InstallAppCard />
          </div>
        ) : (
          <DataTab />
        )}
      </div>
    </div>
  );
}
