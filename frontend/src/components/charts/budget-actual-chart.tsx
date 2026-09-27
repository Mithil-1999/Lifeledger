import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount } from "@/lib/format";
import { CHART_HEIGHT, axisProps, moneyTick, moneyTooltip, tooltipStyle } from "./chart-utils";
import { ChartDataTable } from "./chart-data-table";

export interface BudgetActualPoint {
  category: string;
  budget: number;
  spent: number;
}

/** Budget vs actual spending per category (grouped bars). */
export function BudgetActualChart({ data, currency }: { data: BudgetActualPoint[]; currency: string }) {
  return (
    <figure>
      <BarChart responsive data={data} style={{ width: "100%", height: CHART_HEIGHT }} margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="category" interval={0} tickFormatter={(c: string) => (c.length > 10 ? `${c.slice(0, 9)}…` : c)} {...axisProps} />
        <YAxis tickFormatter={moneyTick(currency)} width={72} {...axisProps} />
        <Tooltip formatter={moneyTooltip(currency)} {...tooltipStyle} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="budget" name="Budget" fill="var(--chart-5)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="spent" name="Spent" fill="var(--chart-4)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
      <ChartDataTable
        caption="Budget vs actual spending by category"
        columns={["Category", "Budget", "Spent"]}
        rows={data.map((d) => [d.category, formatAmount(d.budget, currency), formatAmount(d.spent, currency)])}
      />
    </figure>
  );
}
