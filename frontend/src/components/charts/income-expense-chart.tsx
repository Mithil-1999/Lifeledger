import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount, formatMonth } from "@/lib/format";
import { CHART_HEIGHT, axisProps, moneyTick, moneyTooltip, tooltipStyle } from "./chart-utils";
import { ChartDataTable } from "./chart-data-table";

export interface IncomeExpensePoint {
  month: string; // "2026-09"
  income: number;
  expenses: number;
}

export function IncomeExpenseChart({ data, currency }: { data: IncomeExpensePoint[]; currency: string }) {
  return (
    <figure>
      <BarChart responsive data={data} style={{ width: "100%", height: CHART_HEIGHT }} margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="month" tickFormatter={formatMonth} {...axisProps} />
        <YAxis tickFormatter={moneyTick(currency)} width={72} {...axisProps} />
        <Tooltip formatter={moneyTooltip(currency)} labelFormatter={(m) => formatMonth(String(m))} {...tooltipStyle} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="income" name="Income" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expenses" name="Expenses" fill="var(--chart-4)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
      <ChartDataTable
        caption="Income vs expenses by month"
        columns={["Month", "Income", "Expenses"]}
        rows={data.map((d) => [formatMonth(d.month), formatAmount(d.income, currency), formatAmount(d.expenses, currency)])}
      />
    </figure>
  );
}
