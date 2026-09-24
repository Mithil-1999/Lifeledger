import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount, formatMonth } from "@/lib/format";
import { CHART_HEIGHT, axisProps, moneyTick, moneyTooltip, tooltipStyle } from "./chart-utils";
import { ChartDataTable } from "./chart-data-table";

export interface MonthlyAmountPoint {
  month: string; // "2026-09"
  amount: number;
}

export function MonthlySpendingChart({ data, currency }: { data: MonthlyAmountPoint[]; currency: string }) {
  return (
    <figure>
      <AreaChart responsive data={data} style={{ width: "100%", height: CHART_HEIGHT }} margin={{ left: 4, right: 4 }}>
        <defs>
          <linearGradient id="spending-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="month" tickFormatter={formatMonth} {...axisProps} />
        <YAxis tickFormatter={moneyTick(currency)} width={72} {...axisProps} />
        <Tooltip formatter={moneyTooltip(currency)} labelFormatter={(m) => formatMonth(String(m))} {...tooltipStyle} />
        <Area type="monotone" dataKey="amount" name="Spending" stroke="var(--chart-4)" strokeWidth={2} fill="url(#spending-fill)" />
      </AreaChart>
      <ChartDataTable
        caption="Spending by month"
        columns={["Month", "Spending"]}
        rows={data.map((d) => [formatMonth(d.month), formatAmount(d.amount, currency)])}
      />
    </figure>
  );
}
