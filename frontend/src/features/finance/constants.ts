import { TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import type { LedgerKind, PaymentMethod, RecurrenceInterval } from "./api";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  card: "Card",
  mobile_wallet: "Mobile wallet (eSewa, Khalti…)",
  cheque: "Cheque",
  other: "Other",
};

export const RECURRENCE_LABELS: Record<RecurrenceInterval, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export interface LedgerConfig {
  kind: LedgerKind;
  title: string; // page title
  noun: string; // "income" / "expense"
  path: string; // app route
  icon: LucideIcon;
  tone: "positive" | "negative";
  emptyTitle: string;
  emptyDescription: string;
}

export const LEDGER_CONFIG: Record<LedgerKind, LedgerConfig> = {
  income: {
    kind: "income",
    title: "Income",
    noun: "income",
    path: "/income",
    icon: TrendingUp,
    tone: "positive",
    emptyTitle: "No income recorded yet",
    emptyDescription: "Add your salary, freelance work or any other money coming in.",
  },
  expense: {
    kind: "expense",
    title: "Expenses",
    noun: "expense",
    path: "/expenses",
    icon: TrendingDown,
    tone: "negative",
    emptyTitle: "No expenses recorded yet",
    emptyDescription: "Track rent, food, bills and everything else you spend.",
  },
};
