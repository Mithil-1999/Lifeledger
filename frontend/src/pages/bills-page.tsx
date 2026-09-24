import * as React from "react";
import { useSearchParams } from "react-router";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CalendarClock, CheckCircle2, CircleAlert, History, Loader2, MoreHorizontal, Pencil, Plus, ReceiptText, Trash2 } from "lucide-react";
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
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { StatCard } from "@/features/dashboard/stat-card";
import { PAYMENT_METHOD_LABELS } from "@/features/finance/constants";
import { amountSchema, todayIso } from "@/features/finance/schemas";
import { useBillMutations, useBillPayments, useBills, type Bill, type BillStatus } from "@/features/planning/api";
import { BILL_CATEGORIES, BILL_FREQUENCIES, BILL_STATUS, dueLabel } from "@/features/planning/constants";
import { getErrorMessage } from "@/lib/api";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const billSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100, "Use at most 100 characters."),
  amount: amountSchema,
  category: z.enum(["rent", "wifi", "electricity", "water", "mobile", "subscription", "insurance", "loan", "other"]),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a due date."),
  frequency: z.enum(["one_time", "weekly", "monthly", "quarterly", "yearly"]),
  notes: z.string().trim().max(2000, "Use at most 2000 characters."),
});
type BillFormInput = z.input<typeof billSchema>;
type BillFormValues = z.output<typeof billSchema>;

function BillFormDialog({ open, onOpenChange, bill }: { open: boolean; onOpenChange: (open: boolean) => void; bill: Bill | null }) {
  const { save } = useBillMutations();
  const defaults = React.useCallback(
    (): BillFormInput => ({
      name: bill?.name ?? "",
      amount: bill?.amount ?? "",
      category: bill?.category ?? "rent",
      due_date: bill?.due_date ?? todayIso(),
      frequency: bill?.frequency ?? "monthly",
      notes: bill?.notes ?? "",
    }),
    [bill],
  );
  const { register, handleSubmit, reset, formState: { errors } } = useForm<BillFormInput, unknown, BillFormValues>({
    resolver: zodResolver(billSchema),
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
      {
        id: bill?.id,
        input: {
          ...values,
          notes: values.notes || null,
          // Editing keeps a paid one-time bill paid; everything else stays pending.
          status: bill?.status === "paid" && values.frequency === "one_time" ? "paid" : "pending",
        },
      },
      {
        onSuccess: () => {
          toast.success(bill ? "Bill updated." : "Bill added.");
          onOpenChange(false);
        },
      },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{bill ? "Edit bill" : "Add bill"}</DialogTitle>
          <DialogDescription>Rent, utilities, subscriptions and other regular payments.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {save.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(save.error)}</span>
            </Alert>
          )}
          <FormField id="bill-name" label="Name" error={errors.name?.message}>
            {(aria) => <Input {...aria} placeholder="e.g. Room rent, Worldlink Wi-Fi" autoFocus {...register("name")} />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="bill-amount" label="Amount (NPR)" error={errors.amount?.message}>
              {(aria) => <Input {...aria} inputMode="decimal" placeholder="0.00" {...register("amount")} />}
            </FormField>
            <FormField id="bill-category" label="Category" error={errors.category?.message}>
              {(aria) => (
                <NativeSelect {...aria} {...register("category")}>
                  {Object.entries(BILL_CATEGORIES).map(([value, { label }]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField id="bill-due" label={bill ? "Next due date" : "Due date"} error={errors.due_date?.message}>
              {(aria) => <Input {...aria} type="date" {...register("due_date")} />}
            </FormField>
            <FormField id="bill-frequency" label="Frequency" error={errors.frequency?.message}>
              {(aria) => (
                <NativeSelect {...aria} {...register("frequency")}>
                  {Object.entries(BILL_FREQUENCIES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
          <FormField id="bill-notes" label="Notes" error={errors.notes?.message}>
            {(aria) => <Textarea {...aria} rows={3} placeholder="Optional" {...register("notes")} />}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {bill ? "Save changes" : "Add bill"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const paySchema = z.object({
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  amount: amountSchema,
  record_expense: z.boolean(),
  payment_method: z.enum(["cash", "bank_transfer", "card", "mobile_wallet", "cheque", "other"]),
});
type PayInput = z.input<typeof paySchema>;
type PayValues = z.output<typeof paySchema>;

function PayBillDialog({ bill, onOpenChange }: { bill: Bill | null; onOpenChange: (open: boolean) => void }) {
  const { pay } = useBillMutations();
  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<PayInput, unknown, PayValues>({
    resolver: zodResolver(paySchema),
  });
  const recordExpense = useWatch({ control, name: "record_expense" });
  React.useEffect(() => {
    if (bill) {
      reset({ paid_on: todayIso(), amount: bill.amount, record_expense: true, payment_method: "cash" });
      pay.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill]);

  const onSubmit = handleSubmit((values) =>
    bill &&
    pay.mutate(
      { id: bill.id, ...values },
      {
        onSuccess: (updated) => {
          toast.success(
            updated.status === "paid" ? `${bill.name} marked as paid.` : `${bill.name} paid. Next due ${formatDate(updated.due_date)}.`,
          );
          onOpenChange(false);
        },
      },
    ),
  );

  return (
    <Dialog open={bill !== null} onOpenChange={(next) => !pay.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {bill?.name} as paid</DialogTitle>
          <DialogDescription>
            {bill?.frequency === "one_time" ? "This one-time bill will be marked paid." : "The bill will move to its next due date."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {pay.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(pay.error)}</span>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="pay-date" label="Paid on" error={errors.paid_on?.message}>
              {(aria) => <Input {...aria} type="date" {...register("paid_on")} />}
            </FormField>
            <FormField id="pay-amount" label="Amount paid (NPR)" error={errors.amount?.message}>
              {(aria) => <Input {...aria} inputMode="decimal" {...register("amount")} />}
            </FormField>
          </div>
          <div className="grid gap-3 rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="size-4 accent-primary" {...register("record_expense")} />
              Also record this payment as an expense
            </label>
            {recordExpense && (
              <FormField id="pay-method" label="Payment method">
                {(aria) => (
                  <NativeSelect {...aria} {...register("payment_method")}>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pay.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pay.isPending}>
              {pay.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Mark as paid
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ bill, onOpenChange }: { bill: Bill | null; onOpenChange: (open: boolean) => void }) {
  const { data, isPending } = useBillPayments(bill?.id ?? null);
  return (
    <Dialog open={bill !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{bill?.name}: payment history</DialogTitle>
          <DialogDescription>Every payment you've marked for this bill.</DialogDescription>
        </DialogHeader>
        {isPending ? (
          <Skeleton className="h-24" />
        ) : !data?.length ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <ul className="grid gap-2">
            {data.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                <span>
                  <span className="block">Paid {formatDate(payment.paid_on)}</span>
                  <span className="text-xs text-muted-foreground">
                    For {formatDate(payment.due_date)}
                    {payment.expense_id ? " · recorded as expense" : ""}
                  </span>
                </span>
                <span className="font-medium tabular-nums">{formatAmount(payment.amount, bill?.currency ?? "NPR")}</span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BillCard({ bill, onPay, onEdit, onHistory, onDelete }: { bill: Bill; onPay: () => void; onEdit: () => void; onHistory: () => void; onDelete: () => void }) {
  const { label, icon: Icon } = BILL_CATEGORIES[bill.category];
  const status = BILL_STATUS[bill.status];
  return (
    <Card className={cn("flex min-w-0 flex-col gap-3 p-4", bill.status === "overdue" && "border-destructive/50")}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{bill.name}</h3>
          <p className="text-xs text-muted-foreground">
            {label} · {BILL_FREQUENCIES[bill.frequency]}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${bill.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onHistory}>
              <History /> Payment history
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} className="text-destructive data-[highlighted]:text-destructive">
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-xl font-semibold tabular-nums">{formatAmount(bill.amount, bill.currency)}</p>
          <p className={cn("text-xs", bill.status === "overdue" ? "font-medium text-destructive" : "text-muted-foreground")}>
            {bill.status === "paid" ? `Paid · was due ${formatDate(bill.due_date)}` : `${dueLabel(bill.days_until_due)} · ${formatDate(bill.due_date)}`}
          </p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      {bill.last_paid_on && bill.status !== "paid" && (
        <p className="text-xs text-muted-foreground">Last paid {formatDate(bill.last_paid_on)}</p>
      )}
      {bill.status !== "paid" && (
        <Button variant={bill.status === "overdue" ? "default" : "outline"} size="sm" onClick={onPay}>
          <CheckCircle2 aria-hidden /> Mark as paid
        </Button>
      )}
    </Card>
  );
}

const TABS: { value: BillStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
];

export function BillsPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = React.useState<BillStatus | "all">("all");
  const { data, isPending, isError, error, refetch } = useBills(tab);
  const { remove } = useBillMutations();
  const [formOpen, setFormOpen] = React.useState(() => params.get("new") === "1");
  const [editing, setEditing] = React.useState<Bill | null>(null);
  const [paying, setPaying] = React.useState<Bill | null>(null);
  const [history, setHistory] = React.useState<Bill | null>(null);
  const [deleting, setDeleting] = React.useState<Bill | null>(null);
  const currency = data?.currency ?? "NPR";

  React.useEffect(() => {
    if (params.get("new") === "1") setParams({}, { replace: true });
  }, [params, setParams]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Bills"
        description="Rent, utilities and subscriptions, with due dates and payment history."
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden /> Add bill
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        <StatCard
          label={data ? `Overdue (${data.overdue_count})` : "Overdue"}
          icon={CircleAlert}
          tone="negative"
          loading={isPending}
          value={data ? { amount: data.overdue_total, currency } : null}
        />
        <StatCard
          label={data ? `Due in 30 days (${data.due_soon_count})` : "Due in 30 days"}
          icon={CalendarClock}
          loading={isPending}
          value={data ? { amount: data.due_soon_total, currency } : null}
        />
        <StatCard label="Paid this month" icon={CheckCircle2} tone="positive" loading={isPending} value={data ? { amount: data.paid_this_month_total, currency } : null} />
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as BillStatus | "all")}>
        <TabsList aria-label="Filter bills by status">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <span>Couldn't load bills. {getErrorMessage(error)}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading bills">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        tab === "all" ? (
          <EmptyState icon={ReceiptText} title="No bills yet" description="Add room rent, Wi-Fi, electricity and other regular payments to never miss a due date.">
            <Button onClick={openCreate}>
              <Plus aria-hidden /> Add bill
            </Button>
          </EmptyState>
        ) : (
          <EmptyState icon={ReceiptText} title={`No ${tab} bills`} description="Nothing in this view right now." />
        )
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Bills">
          {data.items.map((bill) => (
            <li key={bill.id} className="min-w-0">
              <BillCard
                bill={bill}
                onPay={() => setPaying(bill)}
                onEdit={() => {
                  setEditing(bill);
                  setFormOpen(true);
                }}
                onHistory={() => setHistory(bill)}
                onDelete={() => setDeleting(bill)}
              />
            </li>
          ))}
        </ul>
      )}

      <BillFormDialog open={formOpen} onOpenChange={setFormOpen} bill={editing} />
      <PayBillDialog bill={paying} onOpenChange={(open) => !open && setPaying(null)} />
      <HistoryDialog bill={history} onOpenChange={(open) => !open && setHistory(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="The bill and its payment history will be deleted. Expenses you recorded from payments are kept."
        confirmLabel="Delete bill"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Bill deleted.");
              setDeleting(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
