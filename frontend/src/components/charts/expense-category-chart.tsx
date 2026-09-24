import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { formatAmount } from "@/lib/format";
import { CHART_COLORS, moneyTooltip, tooltipStyle } from "./chart-utils";
import { ChartDataTable } from "./chart-data-table";

export interface CategoryPoint {
  category: string;
  amount: number;
}

/** Donut of spending by category, with a readable legend showing amount and share. */
export function ExpenseCategoryChart({ data, currency }: { data: CategoryPoint[]; currency: string }) {
  const total = data.reduce((sum, d) => sum + d.amount, 0);
  const share = (amount: number) => (total > 0 ? `${Math.round((amount / total) * 100)}%` : "0%");

  return (
    <figure className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <PieChart responsive style={{ width: "100%", height: 200 }}>
        <Pie data={data} dataKey="amount" nameKey="category" innerRadius="58%" outerRadius="90%" paddingAngle={2} stroke="var(--card)">
          {data.map((entry, index) => (
            <Cell key={entry.category} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={moneyTooltip(currency)} {...tooltipStyle} />
      </PieChart>
      <ul className="grid gap-2 text-sm" aria-hidden>
        {data.map((entry, index) => (
          <li key={entry.category} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.category}</span>
            <span className="font-medium tabular-nums">{share(entry.amount)}</span>
          </li>
        ))}
      </ul>
      <ChartDataTable
        caption="Expenses by category"
        columns={["Category", "Amount", "Share"]}
        rows={data.map((d) => [d.category, formatAmount(d.amount, currency), share(d.amount)])}
      />
    </figure>
  );
}
