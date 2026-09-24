import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/forms/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getErrorMessage } from "@/lib/api";
import { useCategories, useSaveRecord, type LedgerInput, type LedgerRecord } from "./api";
import { PAYMENT_METHOD_LABELS, RECURRENCE_LABELS, type LedgerConfig } from "./constants";
import { ledgerFormSchema, todayIso, type LedgerFormInput, type LedgerFormValues } from "./schemas";

interface EntryFormDialogProps {
  config: LedgerConfig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Record to edit; omit to create a new one. */
  record?: LedgerRecord | null;
}

function defaultsFor(config: LedgerConfig, record?: LedgerRecord | null): LedgerFormInput {
  return {
    amount: record?.amount ?? "",
    date: record?.date ?? todayIso(),
    source: record?.source ?? "",
    category_id: record?.category.id ?? "",
    payment_method: record?.payment_method ?? (config.kind === "income" ? "bank_transfer" : "cash"),
    is_recurring: record?.is_recurring ?? false,
    recurrence_interval: record?.recurrence_interval ?? "",
    description: record?.description ?? "",
    notes: record?.notes ?? "",
    requiresSource: config.kind === "income",
  };
}

function toInput(config: LedgerConfig, values: LedgerFormValues): LedgerInput {
  return {
    amount: values.amount,
    date: values.date,
    category_id: values.category_id,
    payment_method: values.payment_method,
    is_recurring: values.is_recurring,
    recurrence_interval: values.is_recurring && values.recurrence_interval ? values.recurrence_interval : null,
    description: values.description || null,
    notes: values.notes || null,
    ...(config.kind === "income" ? { source: values.source } : {}),
  };
}

export function EntryFormDialog({ config, open, onOpenChange, record }: EntryFormDialogProps) {
  const { data: categories, isPending: categoriesLoading } = useCategories(config.kind);
  const save = useSaveRecord(config.kind);
  const editing = Boolean(record);
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<LedgerFormInput, unknown, LedgerFormValues>({
    resolver: zodResolver(ledgerFormSchema),
    defaultValues: defaultsFor(config, record),
  });
  const isRecurring = useWatch({ control, name: "is_recurring" });

  // Fresh form every time the dialog opens (for a new entry or a different record).
  React.useEffect(() => {
    if (open) {
      reset(defaultsFor(config, record));
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record, config]);

  const onSubmit = handleSubmit((values) =>
    save.mutate(
      { id: record?.id, input: toInput(config, values) },
      {
        onSuccess: () => {
          toast.success(editing ? `${capitalize(config.noun)} updated.` : `${capitalize(config.noun)} added.`);
          onOpenChange(false);
        },
      },
    ),
  );

  const idPrefix = `${config.kind}-form`;

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${config.noun}` : `Add ${config.noun}`}</DialogTitle>
          <DialogDescription>Amounts are in NPR.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {save.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(save.error)}</span>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={`${idPrefix}-amount`} label="Amount (NPR)" error={errors.amount?.message}>
              {(aria) => (
                <Input {...aria} inputMode="decimal" autoComplete="off" placeholder="0.00" autoFocus {...register("amount")} />
              )}
            </FormField>
            <FormField id={`${idPrefix}-date`} label="Date" error={errors.date?.message}>
              {(aria) => <Input {...aria} type="date" {...register("date")} />}
            </FormField>
          </div>

          {config.kind === "income" && (
            <FormField id={`${idPrefix}-source`} label="Source" error={errors.source?.message} hint="Employer, client or who paid you.">
              {(aria) => <Input {...aria} placeholder="e.g. Acme Pvt. Ltd." {...register("source")} />}
            </FormField>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={`${idPrefix}-category`} label="Category" error={errors.category_id?.message}>
              {(aria) => (
                <NativeSelect {...aria} disabled={categoriesLoading} {...register("category_id")}>
                  <option value="">{categoriesLoading ? "Loading…" : "Choose a category"}</option>
                  {categories?.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                      {category.is_system ? "" : " (custom)"}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField id={`${idPrefix}-method`} label="Payment method" error={errors.payment_method?.message}>
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
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="size-4 rounded border-input accent-primary" {...register("is_recurring")} />
              This {config.noun} repeats
            </label>
            {isRecurring && (
              <FormField id={`${idPrefix}-interval`} label="Repeats" error={errors.recurrence_interval?.message}>
                {(aria) => (
                  <NativeSelect {...aria} {...register("recurrence_interval")}>
                    <option value="">Choose how often</option>
                    {Object.entries(RECURRENCE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            )}
          </div>

          <FormField id={`${idPrefix}-description`} label="Description" error={errors.description?.message}>
            {(aria) => (
              <Input
                {...aria}
                placeholder={config.kind === "income" ? "e.g. September salary" : "e.g. Groceries at Bhatbhateni"}
                {...register("description")}
              />
            )}
          </FormField>
          <FormField id={`${idPrefix}-notes`} label="Notes" error={errors.notes?.message}>
            {(aria) => <Textarea {...aria} rows={3} placeholder="Optional" {...register("notes")} />}
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {editing ? "Save changes" : `Add ${config.noun}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
