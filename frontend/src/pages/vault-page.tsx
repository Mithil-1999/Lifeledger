import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  Copy,
  ExternalLink,
  History,
  KeyRound,
  Loader2,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SearchX,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { FormField } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  isLocked,
  useVaultAudit,
  useVaultEntries,
  useVaultEntry,
  useVaultMutations,
  useVaultStatus,
  type VaultEntry,
  type VaultStatus,
} from "@/features/vault/api";
import { AUDIT_LABELS, VAULT_CATEGORIES, safeHref } from "@/features/vault/constants";
import { PasswordGenerator } from "@/features/vault/password-generator";
import { SecretField } from "@/features/vault/secret-field";
import { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

// --- Locked / unconfigured states -----------------------------------------------------------------------------------

function UnlockCard() {
  const { unlock } = useVaultMutations();
  const [password, setPassword] = React.useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!password) return;
    unlock.mutate(password, { onSettled: () => setPassword("") });
  };
  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <span className="mb-1 flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Lock className="size-5" aria-hidden />
        </span>
        <CardTitle>Your vault is locked</CardTitle>
        <CardDescription>Re-enter your LifeVault account password to unlock it. It locks again automatically after a few minutes.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="grid gap-3">
          {unlock.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(unlock.error)}</span>
            </Alert>
          )}
          <FormField id="vault-unlock-password" label="Account password">
            {(aria) => <PasswordInput {...aria} autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />}
          </FormField>
          <Button type="submit" disabled={unlock.isPending || !password}>
            {unlock.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <LockOpen aria-hidden />}
            Unlock vault
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LockTimer({ status }: { status: VaultStatus }) {
  const { lock } = useVaultMutations();
  const until = status.unlocked_until ? new Date(status.unlocked_until).getTime() : 0;
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.round((until - now) / 1000));
  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="off">
        Locks in {minutes}:{seconds}
      </span>
      <Button variant="outline" onClick={() => lock.mutate(undefined, { onSuccess: () => toast.success("Vault locked.") })} disabled={lock.isPending}>
        <Lock aria-hidden /> Lock now
      </Button>
    </div>
  );
}

// --- Entry form ---------------------------------------------------------------------------------------------------------

const entrySchema = z.object({
  website: z.string().trim().min(1, "Enter the website or app name.").max(200),
  url: z
    .string()
    .trim()
    .max(2048)
    .refine((v) => !v || !/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(v) || /^https?:/i.test(v), "Use an http(s) address."),
  username: z.string().trim().max(320),
  email: z.string().trim().max(320),
  password: z.string().max(1024, "Use at most 1024 characters."),
  category: z.enum(["email", "social_media", "banking", "education", "work", "shopping", "government", "hosting", "other"]),
  notes: z.string().max(5000, "Use at most 5000 characters."),
  is_favorite: z.boolean(),
});
type EntryFormInput = z.input<typeof entrySchema>;
type EntryFormValues = z.output<typeof entrySchema>;

function EntryDialog({ open, onOpenChange, entryId }: { open: boolean; onOpenChange: (open: boolean) => void; entryId: string | null }) {
  const { save } = useVaultMutations();
  const { data: entry, isPending: loadingEntry } = useVaultEntry(open ? entryId : null);
  const [showGenerator, setShowGenerator] = React.useState(false);
  const editing = entryId !== null;
  const blank: EntryFormInput = { website: "", url: "", username: "", email: "", password: "", category: "other", notes: "", is_favorite: false };
  const { register, handleSubmit, reset, setValue, setError, control, formState: { errors } } = useForm<EntryFormInput, unknown, EntryFormValues>({
    resolver: zodResolver(entrySchema),
    defaultValues: blank,
  });
  const password = useWatch({ control, name: "password" });

  React.useEffect(() => {
    // The parent remounts this dialog (new `key`) per opening, so local state starts fresh;
    // this only fills the form once the saved entry has loaded.
    if (!open) return;
    reset(
      editing && entry
        ? {
            website: entry.website,
            url: entry.url ?? "",
            username: entry.username ?? "",
            email: entry.email ?? "",
            password: "", // never prefilled: leave blank to keep the current one
            category: entry.category,
            notes: entry.notes ?? "",
            is_favorite: entry.is_favorite,
          }
        : blank,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry, editing]);

  const onSubmit = handleSubmit((v) => {
    if (!editing && !v.password) return setError("password", { message: "Enter or generate a password." });
    save.mutate(
      {
        id: entryId ?? undefined,
        input: {
          website: v.website,
          url: v.url || null,
          username: v.username || null,
          email: v.email || null,
          password: v.password || null,
          category: v.category,
          notes: v.notes || null,
          is_favorite: v.is_favorite,
        },
      },
      {
        onSuccess: () => {
          toast.success(editing ? "Entry updated." : "Entry saved to your vault.");
          setValue("password", ""); // don't keep the plaintext in form state
          onOpenChange(false);
        },
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit vault entry" : "Add vault entry"}</DialogTitle>
          <DialogDescription>Username, email, password and notes are encrypted before they're stored.</DialogDescription>
        </DialogHeader>
        {editing && loadingEntry ? (
          <Skeleton className="h-64" />
        ) : (
          <form onSubmit={onSubmit} noValidate className="grid gap-4" autoComplete="off">
            {save.isError && (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <span>{getErrorMessage(save.error)}</span>
              </Alert>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="vault-website" label="Website / app" error={errors.website?.message}>
                {(aria) => <Input {...aria} autoFocus placeholder="e.g. NIC Asia Bank" {...register("website")} />}
              </FormField>
              <FormField id="vault-url" label="URL" error={errors.url?.message}>
                {(aria) => <Input {...aria} inputMode="url" placeholder="https://…" {...register("url")} />}
              </FormField>
              <FormField id="vault-username" label="Username" error={errors.username?.message}>
                {(aria) => <Input {...aria} autoComplete="off" {...register("username")} />}
              </FormField>
              <FormField id="vault-email" label="Email" error={errors.email?.message}>
                {(aria) => <Input {...aria} type="email" autoComplete="off" {...register("email")} />}
              </FormField>
            </div>
            <FormField
              id="vault-password"
              label="Password"
              error={errors.password?.message}
              hint={editing ? "Leave blank to keep the current password." : undefined}
              labelAction={
                <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => setShowGenerator((s) => !s)}>
                  <Wand2 aria-hidden /> {showGenerator ? "Hide generator" : "Generate"}
                </Button>
              }
            >
              {(aria) => <PasswordInput {...aria} autoComplete="new-password" {...register("password")} />}
            </FormField>
            {showGenerator && (
              <PasswordGenerator
                onUse={(generated) => {
                  setValue("password", generated, { shouldValidate: true });
                  setShowGenerator(false);
                  toast.success("Generated password added. Reveal the field to check it.");
                }}
              />
            )}
            {password && password.length < 12 && <p className="-mt-2 text-xs text-warning">Tip: longer passwords (12+) are much harder to guess.</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="vault-category" label="Category">
                {(aria) => (
                  <NativeSelect {...aria} {...register("category")}>
                    {Object.entries(VAULT_CATEGORIES).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
                <input type="checkbox" className="size-4 accent-primary" {...register("is_favorite")} />
                Favorite
              </label>
            </div>
            <FormField id="vault-notes" label="Notes" error={errors.notes?.message} hint="Encrypted, e.g. security questions or recovery codes.">
              {(aria) => <Textarea {...aria} rows={3} {...register("notes")} />}
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
                {editing ? "Save changes" : "Save entry"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Entry card -------------------------------------------------------------------------------------------------------------

function copyText(value: string, what: string) {
  navigator.clipboard.writeText(value).then(
    () => toast.success(`${what} copied.`),
    () => toast.error("Couldn't access the clipboard."),
  );
}

function EntryCard({ entry, onEdit, onDelete }: { entry: VaultEntry; onEdit: () => void; onDelete: () => void }) {
  const { favorite } = useVaultMutations();
  const href = safeHref(entry.url);
  const account = entry.username ?? entry.email;
  return (
    <Card className="flex h-full min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold uppercase text-accent-foreground" aria-hidden>
          {entry.website.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{entry.website}</h3>
          <p className="text-xs text-muted-foreground">{VAULT_CATEGORIES[entry.category]}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={entry.is_favorite ? `Remove ${entry.website} from favorites` : `Add ${entry.website} to favorites`}
          aria-pressed={entry.is_favorite}
          onClick={() => favorite.mutate({ id: entry.id, is_favorite: !entry.is_favorite })}
        >
          <Star className={cn(entry.is_favorite && "fill-warning text-warning")} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${entry.website}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} className="text-destructive data-[highlighted]:text-destructive">
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {account && (
        <div className="flex min-w-0 items-center gap-1 text-sm">
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={account}>
            {account}
          </span>
          <Button variant="ghost" size="icon" aria-label={`Copy ${entry.website} ${entry.username ? "username" : "email"}`} onClick={() => copyText(account, entry.username ? "Username" : "Email")}>
            <Copy />
          </Button>
        </div>
      )}
      <SecretField entryId={entry.id} label={entry.website} />
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="mt-auto inline-flex min-w-0 items-center gap-1 text-xs text-primary hover:underline">
          <ExternalLink className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{new URL(href).host}</span>
        </a>
      )}
    </Card>
  );
}

function AuditPanel() {
  const { data } = useVaultAudit(true);
  const format = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-primary" aria-hidden /> Recent vault activity
        </CardTitle>
        <CardDescription>Every unlock, change and password reveal is recorded here. Passwords are never logged.</CardDescription>
      </CardHeader>
      <CardContent>
        {!data ? (
          <Skeleton className="h-24" />
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="grid gap-1.5 text-sm" aria-label="Vault activity">
            {data.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-lg border px-3 py-1.5">
                <span className={cn(event.action === "unlock_failed" && "font-medium text-destructive")}>
                  {AUDIT_LABELS[event.action] ?? event.action}
                  {event.entry_label && <span className="text-muted-foreground"> · {event.entry_label}</span>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format.format(new Date(event.created_at))}
                  {event.ip_address && ` · ${event.ip_address}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// --- Page ----------------------------------------------------------------------------------------------------------------------

export function VaultPage() {
  const status = useVaultStatus();
  const unlocked = Boolean(status.data?.configured && status.data.unlocked);
  const [tab, setTab] = React.useState<"all" | "favorites">("all");
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [dialogKey, setDialogKey] = React.useState(0);
  const openDialog = (id: string | null) => {
    setEditingId(id);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  };
  const [deleting, setDeleting] = React.useState<VaultEntry | null>(null);
  const [showActivity, setShowActivity] = React.useState(false);
  const entries = useVaultEntries(unlocked, { search: debounced || undefined, category: category || undefined, favorites: tab === "favorites" });
  const { remove } = useVaultMutations();

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Re-check the lock state when the unlock window ends, or when the server says "locked".
  const { refetch } = status;
  React.useEffect(() => {
    if (!status.data?.unlocked_until) return;
    const ms = new Date(status.data.unlocked_until).getTime() - Date.now();
    const timer = window.setTimeout(() => void refetch(), Math.max(0, ms) + 500);
    return () => window.clearTimeout(timer);
  }, [status.data?.unlocked_until, refetch]);
  React.useEffect(() => {
    if (isLocked(entries.error)) void refetch();
  }, [entries.error, refetch]);

  const header = (
    <PageHeader
      title="Password Vault"
      description="Encrypted storage for your passwords and secrets."
      actions={
        unlocked && status.data ? (
          <>
            <LockTimer status={status.data} />
            <Button
              onClick={() => openDialog(null)}
            >
              <Plus aria-hidden /> Add entry
            </Button>
          </>
        ) : undefined
      }
    />
  );

  if (status.isPending) {
    return (
      <div className="grid gap-6">
        {header}
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }
  if (status.isError) {
    return (
      <div className="grid gap-6">
        {header}
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <span>Couldn't reach the vault. {getErrorMessage(status.error)}</span>
        </Alert>
      </div>
    );
  }
  if (!status.data.configured) {
    return (
      <div className="grid gap-6">
        {header}
        <EmptyState
          icon={ShieldAlert}
          title="The vault isn't set up on this server"
          description="An administrator needs to set VAULT_MASTER_KEY in the server environment before passwords can be stored. See the README."
        />
      </div>
    );
  }
  if (!status.data.unlocked) {
    return (
      <div className="grid gap-6">
        {header}
        <UnlockCard />
      </div>
    );
  }

  const data = entries.data;
  const filtered = Boolean(debounced || category || tab === "favorites");

  return (
    <div className="grid grid-cols-1 gap-6">
      {header}

      <div className="grid grid-cols-1 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "favorites")}>
            <TabsList aria-label="Vault views">
              <TabsTrigger value="all">All {data && <span className="tabular-nums text-muted-foreground">{data.counts.all}</span>}</TabsTrigger>
              <TabsTrigger value="favorites">
                <Star className="size-3.5" aria-hidden /> Favorites {data && <span className="tabular-nums text-muted-foreground">{data.counts.favorites}</span>}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="ghost" size="sm" onClick={() => setShowActivity((s) => !s)} aria-expanded={showActivity}>
            <History aria-hidden /> {showActivity ? "Hide activity" : "Activity"}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]" role="search" aria-label="Filter vault">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" aria-label="Search vault" placeholder="Search site, URL, username or email…" className="pl-9" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <NativeSelect aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {Object.entries(VAULT_CATEGORIES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
                {data ? ` (${data.counts[value] ?? 0})` : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {showActivity && <AuditPanel />}

      {entries.isError && !isLocked(entries.error) ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <span>Couldn't load your vault. {getErrorMessage(entries.error)}</span>
        </Alert>
      ) : !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading vault">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        filtered ? (
          <EmptyState icon={SearchX} title="No matching entries" description="Try a different search, category or view." />
        ) : (
          <EmptyState icon={KeyRound} title="Your vault is empty" description="Save your first password. It's encrypted before it's stored.">
            <Button
              onClick={() => openDialog(null)}
            >
              <Plus aria-hidden /> Add entry
            </Button>
          </EmptyState>
        )
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Vault entries">
          {data.items.map((entry) => (
            <li key={entry.id} className="min-w-0">
              <EntryCard
                entry={entry}
                onEdit={() => openDialog(entry.id)}
                onDelete={() => setDeleting(entry)}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-success" aria-hidden /> Encrypted with AES-256-GCM. Passwords are decrypted one at a time, only when you reveal or copy them.
      </p>

      <EntryDialog key={dialogKey} open={dialogOpen} onOpenChange={setDialogOpen} entryId={editingId} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete ${deleting?.website}?`}
        description="The saved login will be permanently deleted from your vault. This can't be undone."
        confirmLabel="Delete entry"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Entry deleted.");
              setDeleting(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}

