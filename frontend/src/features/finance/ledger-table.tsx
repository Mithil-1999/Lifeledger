import { MoreHorizontal, Pencil, Repeat, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LedgerRecord } from "./api";
import { PAYMENT_METHOD_LABELS, RECURRENCE_LABELS, type LedgerConfig } from "./constants";

interface LedgerTableProps {
  config: LedgerConfig;
  records: LedgerRecord[];
  onEdit: (record: LedgerRecord) => void;
  onDelete: (record: LedgerRecord) => void;
}

function title(config: LedgerConfig, record: LedgerRecord) {
  return (config.kind === "income" ? record.source : record.description) || record.category.name;
}

function subtitle(config: LedgerConfig, record: LedgerRecord) {
  return config.kind === "income" ? record.description : null;
}

function RowActions({ record, onEdit, onDelete, label }: { record: LedgerRecord; label: string } & Omit<LedgerTableProps, "config" | "records">) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${label}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(record)}>
          <Pencil /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDelete(record)} className="text-destructive data-[highlighted]:text-destructive">
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Amount({ config, record }: { config: LedgerConfig; record: LedgerRecord }) {
  return (
    <span className={cn("font-semibold tabular-nums", config.tone === "positive" ? "text-success" : "text-foreground")}>
      {config.kind === "income" ? "+" : "−"}
      {formatMoney(record)}
    </span>
  );
}

/** Table on wide screens, stacked cards on phones. */
export function LedgerTable({ config, records, onEdit, onDelete }: LedgerTableProps) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{config.title} records</caption>
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3">Date</th>
              <th scope="col" className="px-4 py-3">{config.kind === "income" ? "Source" : "Description"}</th>
              <th scope="col" className="px-4 py-3">Category</th>
              <th scope="col" className="px-4 py-3">Method</th>
              <th scope="col" className="px-4 py-3 text-right">Amount</th>
              <th scope="col" className="w-12 px-2 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {records.map((record) => (
              <tr key={record.id} className="hover:bg-muted/30">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(record.date)}</td>
                <td className="max-w-72 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate font-medium">{title(config, record)}</span>
                    {record.is_recurring && (
                      <Badge variant="outline" title={`Repeats ${record.recurrence_interval}`}>
                        <Repeat aria-hidden /> {record.recurrence_interval && RECURRENCE_LABELS[record.recurrence_interval]}
                      </Badge>
                    )}
                  </div>
                  {subtitle(config, record) && <div className="truncate text-xs text-muted-foreground">{subtitle(config, record)}</div>}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="secondary">{record.category.name}</Badge>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {PAYMENT_METHOD_LABELS[record.payment_method].replace(/ \(.*\)$/, "")}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <Amount config={config} record={record} />
                </td>
                <td className="px-2 py-2 text-right">
                  <RowActions record={record} onEdit={onEdit} onDelete={onDelete} label={title(config, record)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid grid-cols-1 gap-2 md:hidden" aria-label={`${config.title} records`}>
        {records.map((record) => (
          <li key={record.id} className="flex min-w-0 items-start gap-3 rounded-xl border bg-card p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                {/* min-w-0 lets long titles truncate instead of widening the card */}
                <span className="min-w-0 truncate font-medium">{title(config, record)}</span>
                <Amount config={config} record={record} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{formatDate(record.date, { day: "numeric", month: "short", year: "numeric" })}</span>
                <span aria-hidden>·</span>
                <span>{record.category.name}</span>
                {record.is_recurring && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Repeat className="size-3" aria-hidden />
                      {record.recurrence_interval && RECURRENCE_LABELS[record.recurrence_interval]}
                    </span>
                  </>
                )}
              </div>
            </div>
            <RowActions record={record} onEdit={onEdit} onDelete={onDelete} label={title(config, record)} />
          </li>
        ))}
      </ul>
    </>
  );
}
