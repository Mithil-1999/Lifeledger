import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount, formatMonth } from "@/lib/format";
import { ChartDataTable } from "./chart-data-table";
import { CHART_HEIGHT, axisProps, moneyTick, moneyTooltip, tooltipStyle } from "./chart-utils";
import type { MonthlyAmountPoint } from "./monthly-spending-chart";

/** Single-series bar chart of totals per month (e.g. a year of income or expenses). */
export function MonthlyTotalsChart({
  data,
  currency,
  label,
  color = "var(--chart-1)",
}: {
  data: MonthlyAmountPoint[];
  currency: string;
  label: string;
  color?: string;
}) {
  const shortMonth = (m: string) => formatMonth(m).split(" ")[0];
  return (
    <figure>
      <BarChart responsive data={data} style={{ width: "100%", height: CHART_HEIGHT }} margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="month" tickFormatter={shortMonth} interval={0} {...axisProps} />
        <YAxis tickFormatter={moneyTick(currency)} width={72} {...axisProps} />
        <Tooltip formatter={moneyTooltip(currency)} labelFormatter={(m) => formatMonth(String(m))} {...tooltipStyle} />
        <Bar dataKey="amount" name={label} fill={color} radius={[4, 4, 0, 0]} maxBarSize={32} />
      </BarChart>
      <ChartDataTable
        caption={`${label} by month`}
        columns={["Month", label]}
        rows={data.map((d) => [formatMonth(d.month), formatAmount(d.amount, currency)])}
      />
    </figure>
  );
}
