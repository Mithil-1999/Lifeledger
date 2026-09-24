import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount, formatMonth } from "@/lib/format";
import { CHART_HEIGHT, axisProps, moneyTick, moneyTooltip, tooltipStyle } from "./chart-utils";
import { ChartDataTable } from "./chart-data-table";
import type { MonthlyAmountPoint } from "./monthly-spending-chart";

export function SavingsChart({ data, currency }: { data: MonthlyAmountPoint[]; currency: string }) {
  return (
    <figure>
      <LineChart responsive data={data} style={{ width: "100%", height: CHART_HEIGHT }} margin={{ left: 4, right: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="month" tickFormatter={formatMonth} {...axisProps} />
        <YAxis tickFormatter={moneyTick(currency)} width={72} {...axisProps} />
        <Tooltip formatter={moneyTooltip(currency)} labelFormatter={(m) => formatMonth(String(m))} {...tooltipStyle} />
        <Line type="monotone" dataKey="amount" name="Savings" stroke="var(--chart-1)" strokeWidth={2.5} dot={{ r: 3 }} />
      </LineChart>
      <ChartDataTable
        caption="Savings balance by month"
        columns={["Month", "Savings"]}
        rows={data.map((d) => [formatMonth(d.month), formatAmount(d.amount, currency)])}
      />
    </figure>
  );
}
