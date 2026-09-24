import { CalendarClock, CircleAlert, ReceiptText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatMoney } from "@/lib/format";
import type { BillItem, DashboardSummary } from "./api";
import { ItemList, Panel, PanelEmpty, PanelSkeleton } from "./panel";

const TABS = [
  { value: "upcoming", label: "Upcoming", icon: CalendarClock, empty: "No upcoming bills." },
  { value: "overdue", label: "Overdue", icon: CircleAlert, empty: "No overdue bills." },
] as const;

function BillRow({ bill }: { bill: BillItem }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
      <span className="min-w-0">
        <span className="block truncate">{bill.name}</span>
        <span className="text-xs text-muted-foreground">Due {formatDate(bill.due_date, { day: "numeric", month: "short" })}</span>
      </span>
      <span className="shrink-0 font-medium tabular-nums">{formatMoney(bill.amount)}</span>
    </div>
  );
}

export function BillsPanel({ bills, loading }: { bills?: DashboardSummary["bills"]; loading: boolean }) {
  const unavailable = bills && !bills.available;
  return (
    <Panel title="Bills" icon={ReceiptText} href="/bills" comingInPhase={unavailable ? bills.available_from_phase : null}>
      <Tabs defaultValue="upcoming">
        <TabsList aria-label="Bill views">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {loading || !bills ? (
              <PanelSkeleton />
            ) : !bills.available ? (
              <PanelEmpty
                icon={tab.icon}
                title={`${tab.label} bills will appear here`}
                description={`Rent, Wi-Fi, electricity and other bills arrive in Phase ${bills.available_from_phase}.`}
              />
            ) : bills[tab.value].length === 0 ? (
              <PanelEmpty icon={tab.icon} title={tab.empty} description="Nothing needs paying right now." />
            ) : (
              <ItemList items={bills[tab.value]} render={(bill) => <BillRow bill={bill} />} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </Panel>
  );
}
