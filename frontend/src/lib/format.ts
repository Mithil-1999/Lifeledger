/**
 * Display formatting. Amounts arrive from the API as exact decimal strings ("1234.50")
 * and are only converted to numbers here, for display.
 */

export interface Money {
  amount: string;
  currency: string;
}

/** Locale per currency; NPR uses South Asian digit grouping (12,34,567.50). */
const CURRENCY_LOCALES: Record<string, string> = { NPR: "en-IN", INR: "en-IN" };
const formatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string, compact: boolean) {
  const key = `${currency}|${compact}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(CURRENCY_LOCALES[currency] ?? "en-US", {
      style: "currency",
      currency,
      currencyDisplay: "code",
      ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

export function formatMoney(money: Money, options: { compact?: boolean } = {}): string {
  const value = Number(money.amount);
  if (!Number.isFinite(value)) return "—";
  return currencyFormatter(money.currency, options.compact ?? false).format(value);
}

export function formatAmount(amount: string | number, currency: string, options: { compact?: boolean } = {}) {
  return formatMoney({ amount: String(amount), currency }, options);
}

/** "2026-09-24" -> "Thu, 24 Sep 2026" (date-only strings are treated as calendar dates, not UTC instants). */
export function formatDate(isoDate: string, options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" }) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** "2026-09" -> "Sep 2026" */
export function formatMonth(yearMonth: string) {
  return formatDate(`${yearMonth}-01`, { month: "short", year: "numeric" });
}

export function greeting(hour = new Date().getHours()) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
