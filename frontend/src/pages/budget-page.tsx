import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ChartPie, ChevronLeft, ChevronRight, Copy, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories } from "@/features/finance/api";
import { amountSchema } from "@/features/finance/schemas";
import { useBudgetMonth, useBudgetMutations, type Budget } from "@/features/planning/api";
import { BUDGET_STATUS, currentMonth, shiftMonth } from "@/features/planning/constants";
import { getErrorMessage } from "@/lib/api";
import { formatAmount, formatMonth } from "@/lib/format";

const budgetSchema = z.object({
  category_id: z.string().min(1, "Choose a category."),
  amount: amountSchema,
  warning_threshold: z.coerce.number<string>().int("Use a whole number.").min(1, "Use 1–100.").max(100, "Use 1–100."),
});
type BudgetFormInput = z.input<typeof budgetSchema>;
type BudgetFormValues = z.output<typeof budgetSchema>;

function BudgetFormDialog({
  open,
  onOpenChange,
  month,
  budget,
  usedCategoryIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  budget: Budget | null;
  usedCategoryIds: Set<string>;
}) {
  const { data: categories } = useCategories("expense");
  const { save } = useBudgetMutations();
  const defaults = React.useCallback(
    (): BudgetFormInput => ({
      category_id: budget?.category.id ?? "",
      amount: budget?.amount ?? "",
      warning_threshold: String(budget?.warning_threshold ?? 80),
    }),
    [budget],
  );
  const { register, handleSubmit, reset, formState: { errors } } = useForm<BudgetFormInput, unknown, BudgetFormValues>({
    resolver: zodResolver(budgetSchema),
    defaultValues: defaults(),
  });
  React.useEffect(() => {
    if (open) {
      reset(defaults());
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults]);

  const available = categories?.filter((c) => c.id === budget?.category.id || !usedCategoryIds.has(c.id)) ?? [];
  const onSubmit = handleSubmit((values) =>
    save.mutate(
      { id: budget?.id, category_id: values.category_id, month, amount: values.amount, warning_threshold: values.warning_threshold },
      {
        onSuccess: () => {
          toast.success(budget ? "Budget updated." : "Budget added.");
          onOpenChange(false);
        },
      },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{budget ? `Edit ${budget.category.name} budget` : "Add budget"}</DialogTitle>
          <DialogDescription>Monthly limit for {formatMonth(month)}, in NPR.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {save.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(save.error)}</span>
            </Alert>
          )}
          <FormField id="budget-category" label="Category" error={errors.category_id?.message}>
            {(aria) => (
              <NativeSelect {...aria} disabled={Boolean(budget)} {...register("category_id")}>
                <option value="">Choose a category</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="budget-amount" label="Monthly limit (NPR)" error={errors.amount?.message}>
              {(aria) => <Input {...aria} inputMode="decimal" placeholder="0.00" autoFocus {...register("amount")} />}
            </FormField>
            <FormField
              id="budget-threshold"
              label="Warn at (%)"
              error={errors.warning_threshold?.message}
              hint="Highlight when spending reaches this share."
            >
              {(aria) => <Input {...aria} type="number" min={1} max={100} step={1} {...register("warning_threshold")} />}
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {budget ? "Save changes" : "Add budget"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BudgetCard({ budget, currency, onEdit, onDelete }: { budget: Budget; currency: string; onEdit: () => void; onDelete: () => void }) {
  const status = BUDGET_STATUS[budget.status];
  const over = budget.status === "over";
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{budget.category.name}</h3>
          <p className="text-xs text-muted-foreground">Warns at {budget.warning_threshold}%</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={status.variant}>{status.label}</Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${budget.category.name} budget`}>
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
      </div>
      <Progress
        value={Number(budget.percent_used)}
        label={`${budget.category.name}: ${budget.percent_used}% of budget used`}
        tone={budget.status === "ok" ? "success" : budget.status === "warning" ? "warning" : "destructive"}
      />
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Budget</dt>
          <dd className="font-medium tabular-nums">{formatAmount(budget.amount, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Spent</dt>
          <dd className="font-medium tabular-nums">{formatAmount(budget.spent, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{over ? "Over by" : "Remaining"}</dt>
          <dd className={over ? "font-medium tabular-nums text-destructive" : "font-medium tabular-nums"}>
            {formatAmount(over ? budget.remaining.replace("-", "") : budget.remaining, currency)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{budget.percent_used}% used</p>
    </Card>
  );
}

export function BudgetPage() {
  const [month, setMonth] = React.useState(currentMonth);
  const { data, isPending, isError, error, refetch } = useBudgetMonth(month);
  const { remove, copy } = useBudgetMutations();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Budget | null>(null);
  const [deleting, setDeleting] = React.useState<Budget | null>(null);
  const currency = data?.currency ?? "NPR";
  const usedIds = new Set(data?.budgets.map((b) => b.category.id));
  const previous = shiftMonth(month, -1);

  const copyPrevious = () =>
    copy.mutate(
      { from_month: previous, to_month: month },
      {
        onSuccess: ({ copied, skipped }) =>
          copied > 0
            ? toast.success(`Copied ${copied} budget${copied === 1 ? "" : "s"} from ${formatMonth(previous)}.`)
            : toast.info(skipped > 0 ? "Those budgets already exist for this month." : `No budgets found in ${formatMonth(previous)}.`),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Budget"
        description="Monthly spending limits per category, tracked against your real expenses."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus aria-hidden /> Add budget
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1" role="group" aria-label="Month">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft />
          </Button>
          <Input type="month" aria-label="Budget month" className="w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight />
          </Button>
        </div>
        <Button variant="outline" onClick={copyPrevious} disabled={copy.isPending}>
          {copy.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Copy aria-hidden />}
          Copy from {formatMonth(previous)}
        </Button>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <span>Couldn't load budgets. {getErrorMessage(error)}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading budgets">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : data.budgets.length === 0 ? (
        <EmptyState
          icon={ChartPie}
          title={`No budgets for ${formatMonth(month)}`}
          description="Set a monthly limit for categories like Food or Rent and watch your progress."
        >
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus aria-hidden /> Add budget
            </Button>
            <Button variant="outline" onClick={copyPrevious}>
              <Copy aria-hidden /> Copy from {formatMonth(previous)}
            </Button>
          </div>
        </EmptyState>
      ) : (
        <>
          <Card className="grid gap-3 p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-medium text-muted-foreground">{formatMonth(month)} total</h2>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatAmount(data.total_spent, currency)}{" "}
                  <span className="text-base font-normal text-muted-foreground">of {formatAmount(data.total_budget, currency)}</span>
                </p>
              </div>
              <p className={data.total_remaining.startsWith("-") ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"}>
                {data.total_remaining.startsWith("-")
                  ? `${formatAmount(data.total_remaining.slice(1), currency)} over budget`
                  : `${formatAmount(data.total_remaining, currency)} remaining`}
              </p>
            </div>
            <Progress
              value={Number(data.percent_used)}
              label={`${data.percent_used}% of this month's budget used`}
              tone={data.total_remaining.startsWith("-") ? "destructive" : "default"}
            />
            {Number(data.unbudgeted_spent) > 0 && (
              <p className="text-xs text-muted-foreground">
                Plus {formatAmount(data.unbudgeted_spent, currency)} spent in categories without a budget.
              </p>
            )}
          </Card>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Budgets">
            {data.budgets.map((budget) => (
              <li key={budget.id} className="min-w-0">
                <BudgetCard
                  budget={budget}
                  currency={currency}
                  onEdit={() => {
                    setEditing(budget);
                    setFormOpen(true);
                  }}
                  onDelete={() => setDeleting(budget)}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <BudgetFormDialog open={formOpen} onOpenChange={setFormOpen} month={month} budget={editing} usedCategoryIds={usedIds} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete the ${deleting?.category.name} budget?`}
        description="Your expenses aren't affected; only this month's limit is removed."
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Budget deleted.");
              setDeleting(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
