import { z } from "zod";

/** "1,500.5" -> "1500.5". Amounts stay strings: no float conversion anywhere. */
export function normalizeAmount(value: string) {
  return value.replace(/[,\s]/g, "");
}

const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export const amountSchema = z
  .string()
  .transform(normalizeAmount)
  .refine((v) => v.length > 0, "Enter an amount.")
  .refine((v) => v.length === 0 || AMOUNT_PATTERN.test(v), "Use a number with at most 2 decimal places.")
  .refine((v) => !AMOUNT_PATTERN.test(v) || /[1-9]/.test(v), "Amount must be greater than 0.");

export const ledgerFormSchema = z
  .object({
    amount: amountSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
    source: z.string().trim().max(120, "Use at most 120 characters."),
    category_id: z.string().min(1, "Choose a category."),
    payment_method: z.enum(["cash", "bank_transfer", "card", "mobile_wallet", "cheque", "other"]),
    is_recurring: z.boolean(),
    recurrence_interval: z.enum(["", "weekly", "monthly", "quarterly", "yearly"]),
    description: z.string().trim().max(255, "Use at most 255 characters."),
    notes: z.string().trim().max(2000, "Use at most 2000 characters."),
    requiresSource: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.requiresSource && !values.source) {
      ctx.addIssue({ code: "custom", path: ["source"], message: "Enter where this income came from." });
    }
    if (values.is_recurring && !values.recurrence_interval) {
      ctx.addIssue({ code: "custom", path: ["recurrence_interval"], message: "Choose how often this repeats." });
    }
  });

export type LedgerFormInput = z.input<typeof ledgerFormSchema>;
export type LedgerFormValues = z.output<typeof ledgerFormSchema>;

/** Today's date in the browser's timezone, as YYYY-MM-DD. */
export function todayIso() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
