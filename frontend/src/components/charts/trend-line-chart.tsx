import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount, formatMonth } from "@/lib/format";
import { CHART_HEIGHT, axisProps, moneyTick, moneyTooltip, tooltipStyle } from "./chart-utils";
import { ChartDataTable } from "./chart-data-table";

export interface TrendPoint {
  month: string; // "2026-09"
  /** null = no value for this month (e.g. it hasn't started yet); drawn as a gap, never as 0. */
  amount: number | null;
}

/** Single-series line over months, e.g. a running balance. */
export function TrendLineChart({ data, currency, label, color = "var(--chart-1)" }: { data: TrendPoint[]; currency: string; label: string; color?: string }) {
  return (
    <figure>
      <LineChart responsive data={data} style={{ width: "100%", height: CHART_HEIGHT }} margin={{ left: 4, right: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="month" tickFormatter={(m) => formatMonth(m).split(" ")[0]} {...axisProps} />
        <YAxis tickFormatter={moneyTick(currency)} width={72} {...axisProps} />
        <Tooltip formatter={moneyTooltip(currency)} labelFormatter={(m) => formatMonth(String(m))} {...tooltipStyle} />
        <Line type="monotone" dataKey="amount" name={label} stroke={color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
      </LineChart>
      <ChartDataTable
        caption={`${label} by month`}
        columns={["Month", label]}
        rows={data.map((d) => [formatMonth(d.month), d.amount === null ? "—" : formatAmount(d.amount, currency)])}
      />
    </figure>
  );
}
