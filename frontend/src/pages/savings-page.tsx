import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, History, Loader2, MoreHorizontal, Pencil, PiggyBank, Plus, Target, Trash2, Trophy } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { FormField } from "@/components/forms/form-field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { StatCard } from "@/features/dashboard/stat-card";
import { amountSchema, normalizeAmount, todayIso } from "@/features/finance/schemas";
import { useContributions, useSavings, useSavingsMutations, type SavingsGoal } from "@/features/planning/api";
import { getErrorMessage } from "@/lib/api";
import { formatAmount, formatDate } from "@/lib/format";

// Starting/current balance may be 0 (unlike other amounts).
const balanceSchema = z
  .string()
  .transform(normalizeAmount)
  .refine((v) => v === "" || /^\d{1,12}(\.\d{1,2})?$/.test(v), "Use a number with at most 2 decimal places.")
  .transform((v) => v || "0");

const goalSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100, "Use at most 100 characters."),
  target_amount: amountSchema,
  current_amount: balanceSchema,
  target_date: z.string(),
  description: z.string().trim().max(2000, "Use at most 2000 characters."),
});
type GoalFormInput = z.input<typeof goalSchema>;
type GoalFormValues = z.output<typeof goalSchema>;

function GoalFormDialog({ open, onOpenChange, goal }: { open: boolean; onOpenChange: (open: boolean) => void; goal: SavingsGoal | null }) {
  const { save } = useSavingsMutations();
  const defaults = React.useCallback(
    (): GoalFormInput => ({
      name: goal?.name ?? "",
      target_amount: goal?.target_amount ?? "",
      current_amount: goal?.current_amount ?? "",
      target_date: goal?.target_date ?? "",
      description: goal?.description ?? "",
    }),
    [goal],
  );
  const { register, handleSubmit, reset, formState: { errors } } = useForm<GoalFormInput, unknown, GoalFormValues>({
    resolver: zodResolver(goalSchema),
    defaultValues: defaults(),
  });
  React.useEffect(() => {
    if (open) {
      reset(defaults());
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults]);

  const onSubmit = handleSubmit((values) =>
    save.mutate(
      { id: goal?.id, input: { ...values, target_date: values.target_date || null, description: values.description || null } },
      {
        onSuccess: () => {
          toast.success(goal ? "Goal updated." : "Goal created.");
          onOpenChange(false);
        },
      },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit savings goal" : "New savings goal"}</DialogTitle>
          <DialogDescription>Amounts are in NPR.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {save.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(save.error)}</span>
            </Alert>
          )}
          <FormField id="goal-name" label="Name" error={errors.name?.message}>
            {(aria) => <Input {...aria} placeholder="e.g. Emergency fund, Laptop, Trip to Pokhara" autoFocus {...register("name")} />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="goal-target" label="Target amount (NPR)" error={errors.target_amount?.message}>
              {(aria) => <Input {...aria} inputMode="decimal" placeholder="0.00" {...register("target_amount")} />}
            </FormField>
            <FormField
              id="goal-current"
              label="Current amount (NPR)"
              error={errors.current_amount?.message}
              hint={goal ? "Changing this logs an adjustment." : "What you've already saved."}
            >
              {(aria) => <Input {...aria} inputMode="decimal" placeholder="0.00" {...register("current_amount")} />}
            </FormField>
          </div>
          <FormField id="goal-date" label="Target date (optional)" error={errors.target_date?.message}>
            {(aria) => <Input {...aria} type="date" {...register("target_date")} />}
          </FormField>
          <FormField id="goal-description" label="Description" error={errors.description?.message}>
            {(aria) => <Textarea {...aria} rows={3} placeholder="Optional" {...register("description")} />}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {goal ? "Save changes" : "Create goal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const contributionSchema = z.object({
  amount: amountSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  note: z.string().trim().max(255, "Use at most 255 characters."),
});
type ContributionInput = z.input<typeof contributionSchema>;
type ContributionValues = z.output<typeof contributionSchema>;

function ContributionDialog({
  target,
  onOpenChange,
}: {
  target: { goal: SavingsGoal; kind: "deposit" | "withdrawal" } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { contribute } = useSavingsMutations();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<ContributionInput, unknown, ContributionValues>({
    resolver: zodResolver(contributionSchema),
  });
  React.useEffect(() => {
    if (target) {
      reset({ amount: "", date: todayIso(), note: "" });
      contribute.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const deposit = target?.kind === "deposit";

  const onSubmit = handleSubmit((values) =>
    target &&
    contribute.mutate(
      { id: target.goal.id, kind: target.kind, ...values, note: values.note || null },
      {
        onSuccess: () => {
          toast.success(deposit ? "Money added." : "Withdrawal recorded.");
          onOpenChange(false);
        },
      },
    ),
  );

  return (
    <Dialog open={target !== null} onOpenChange={(next) => !contribute.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{deposit ? `Add money to ${target?.goal.name}` : `Withdraw from ${target?.goal.name}`}</DialogTitle>
          <DialogDescription>
            Current balance: {target ? formatAmount(target.goal.current_amount, target.goal.currency) : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {contribute.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(contribute.error)}</span>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="contribution-amount" label="Amount (NPR)" error={errors.amount?.message}>
              {(aria) => <Input {...aria} inputMode="decimal" placeholder="0.00" autoFocus {...register("amount")} />}
            </FormField>
            <FormField id="contribution-date" label="Date" error={errors.date?.message}>
              {(aria) => <Input {...aria} type="date" {...register("date")} />}
            </FormField>
          </div>
          <FormField id="contribution-note" label="Note" error={errors.note?.message}>
            {(aria) => <Input {...aria} placeholder="Optional" {...register("note")} />}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={contribute.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={contribute.isPending}>
              {contribute.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {deposit ? "Add money" : "Withdraw"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContributionHistory({ goal, onOpenChange }: { goal: SavingsGoal | null; onOpenChange: (open: boolean) => void }) {
  const { data, isPending } = useContributions(goal?.id ?? null);
  return (
    <Dialog open={goal !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{goal?.name}: history</DialogTitle>
          <DialogDescription>Deposits, withdrawals and balance adjustments.</DialogDescription>
        </DialogHeader>
        {isPending ? (
          <Skeleton className="h-24" />
        ) : !data?.length ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="grid max-h-80 gap-2 overflow-y-auto">
            {data.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block">{formatDate(c.date)}</span>
                  {c.note && <span className="block truncate text-xs text-muted-foreground">{c.note}</span>}
                </span>
                <span className={c.amount.startsWith("-") ? "font-medium tabular-nums text-destructive" : "font-medium tabular-nums text-success"}>
                  {c.amount.startsWith("-") ? "−" : "+"}
                  {formatAmount(c.amount.replace("-", ""), goal?.currency ?? "NPR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GoalCard({
  goal,
  onDeposit,
  onWithdraw,
  onEdit,
  onHistory,
  onDelete,
}: {
  goal: SavingsGoal;
  onDeposit: () => void;
  onWithdraw: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{goal.name}</h3>
          {goal.target_date && <p className="text-xs text-muted-foreground">Target {formatDate(goal.target_date)}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {goal.completed && (
            <Badge variant="success">
              <Trophy aria-hidden /> Reached
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${goal.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onHistory}>
                <History /> History
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDelete} className="text-destructive data-[highlighted]:text-destructive">
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div>
        <p className="text-xl font-semibold tabular-nums">{formatAmount(goal.current_amount, goal.currency)}</p>
        <p className="text-xs text-muted-foreground">of {formatAmount(goal.target_amount, goal.currency)}</p>
      </div>
      <Progress value={Number(goal.progress_percent)} label={`${goal.name}: ${goal.progress_percent}% saved`} tone={goal.completed ? "success" : "default"} />
      <p className="text-xs text-muted-foreground">
        {goal.progress_percent}% saved
        {!goal.completed && ` · ${formatAmount(goal.remaining_amount, goal.currency)} to go`}
        {goal.monthly_needed && ` · ${formatAmount(goal.monthly_needed, goal.currency)}/month to reach it on time`}
      </p>
      {goal.description && <p className="line-clamp-2 text-sm text-muted-foreground">{goal.description}</p>}
      <div className="mt-auto grid grid-cols-2 gap-2">
        <Button size="sm" onClick={onDeposit}>
          <ArrowDownToLine aria-hidden /> Add money
        </Button>
        <Button size="sm" variant="outline" onClick={onWithdraw} disabled={Number(goal.current_amount) === 0}>
          <ArrowUpFromLine aria-hidden /> Withdraw
        </Button>
      </div>
    </Card>
  );
}

export function SavingsPage() {
  const { data, isPending, isError, error, refetch } = useSavings();
  const { remove } = useSavingsMutations();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SavingsGoal | null>(null);
  const [contribution, setContribution] = React.useState<{ goal: SavingsGoal; kind: "deposit" | "withdrawal" } | null>(null);
  const [history, setHistory] = React.useState<SavingsGoal | null>(null);
  const [deleting, setDeleting] = React.useState<SavingsGoal | null>(null);
  const currency = data?.currency ?? "NPR";
  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Savings"
        description="Savings goals, what you've put aside, and how far you have to go."
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden /> New goal
          </Button>
        }
      />

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <span>Couldn't load savings goals. {getErrorMessage(error)}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading savings goals">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : data.goals.length === 0 ? (
        <EmptyState icon={PiggyBank} title="No savings goals yet" description="Create a goal like an emergency fund or a new laptop and track your progress.">
          <Button onClick={openCreate}>
            <Plus aria-hidden /> New goal
          </Button>
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
            <StatCard label="Total saved" icon={PiggyBank} tone="positive" value={{ amount: data.total_saved, currency }} />
            <StatCard label="Total of targets" icon={Target} value={{ amount: data.total_target, currency }} />
            <Card className="flex flex-col justify-between gap-3 p-4">
              <span className="text-sm font-medium text-muted-foreground">Overall progress</span>
              <p className="text-xl font-semibold tabular-nums sm:text-2xl">{data.progress_percent}%</p>
              <Progress value={Number(data.progress_percent)} label={`Overall ${data.progress_percent}% of all targets saved`} />
            </Card>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Savings goals">
            {data.goals.map((goal) => (
              <li key={goal.id} className="min-w-0">
                <GoalCard
                  goal={goal}
                  onDeposit={() => setContribution({ goal, kind: "deposit" })}
                  onWithdraw={() => setContribution({ goal, kind: "withdrawal" })}
                  onEdit={() => {
                    setEditing(goal);
                    setFormOpen(true);
                  }}
                  onHistory={() => setHistory(goal)}
                  onDelete={() => setDeleting(goal)}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <GoalFormDialog open={formOpen} onOpenChange={setFormOpen} goal={editing} />
      <ContributionDialog target={contribution} onOpenChange={(open) => !open && setContribution(null)} />
      <ContributionHistory goal={history} onOpenChange={(open) => !open && setHistory(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="The goal and its history will be permanently deleted. This can't be undone."
        confirmLabel="Delete goal"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Goal deleted.");
              setDeleting(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
