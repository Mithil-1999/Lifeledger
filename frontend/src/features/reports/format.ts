import { formatAmount } from "@/lib/format";

export const money = (amount: string, currency: string) => formatAmount(amount, currency);

/** "12.5%" or an explicit dash when a percentage can't be computed (never a fake 0%). */
export const pct = (value: string | null) => (value === null ? "—" : `${value}%`);

export const isNegative = (amount: string) => amount.startsWith("-");
export const isZero = (amount: string) => Number(amount) === 0;
