import { Link } from "react-router";
import { BellRing, CalendarDays, Clock, ExternalLink, MapPin, Pencil, Repeat, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatAmount } from "@/lib/format";
import type { CalendarItem, EventCategory } from "./api";
import { EVENT_CATEGORIES, EVENT_RECURRENCE, SOURCES, itemColor, itemTypeLabel, reminderLabel, statusLabel, timeLabel } from "./constants";
import { formatDay } from "./dates";

interface ItemDetailsDialogProps {
  item: CalendarItem | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (item: CalendarItem) => void;
  onDelete: (item: CalendarItem) => void;
}

function Detail({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function ItemDetailsDialog({ item, onOpenChange, onEdit, onDelete }: ItemDetailsDialogProps) {
  const source = item ? SOURCES[item.source] : null;
  const shortDay = (iso: string) => formatDay(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {item && source && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: itemColor(item) }} aria-hidden />
                {itemTypeLabel(item)}
                {item.source === "event" && item.category && <span>· {EVENT_CATEGORIES[item.category as EventCategory]?.label}</span>}
              </div>
              <DialogTitle className={item.is_done ? "text-muted-foreground line-through" : undefined}>{item.title}</DialogTitle>
              <DialogDescription>
                {item.source === "event" ? "Your calendar event." : `From ${source.module}. Changes are made there, so nothing is duplicated.`}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2.5">
              <Detail icon={CalendarDays}>
                {shortDay(item.date)}
                {item.end_date !== item.date && ` – ${shortDay(item.end_date)}`}
              </Detail>
              <Detail icon={Clock}>{timeLabel(item)}</Detail>
              {item.location && <Detail icon={MapPin}>{item.location}</Detail>}
              {item.recurrence && (
                <Detail icon={Repeat}>
                  Repeats {(EVENT_RECURRENCE[item.recurrence as keyof typeof EVENT_RECURRENCE] ?? item.recurrence).toLowerCase()}
                  {item.is_projected && <span className="text-muted-foreground"> · upcoming repeat</span>}
                </Detail>
              )}
              {item.reminder_minutes !== null && <Detail icon={BellRing}>Reminder: {reminderLabel(item.reminder_minutes)?.toLowerCase()}</Detail>}
              <div className="flex flex-wrap gap-1.5">
                {item.is_overdue && <Badge variant="destructive">{item.source === "reminder" ? "Due" : "Overdue"}</Badge>}
                {!item.is_overdue && statusLabel(item.status) && <Badge variant={item.is_done ? "success" : "outline"}>{statusLabel(item.status)}</Badge>}
                {item.amount && item.currency && <Badge variant="secondary">{formatAmount(item.amount, item.currency)}</Badge>}
                {item.priority && <Badge variant="outline">{item.priority[0].toUpperCase() + item.priority.slice(1)} priority</Badge>}
                {item.source !== "event" && item.category && <Badge variant="outline">{item.category}</Badge>}
              </div>
              {item.description && <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-sm">{item.description}</p>}
            </div>

            <DialogFooter>
              {item.source === "event" ? (
                <>
                  <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => onDelete(item)}>
                    <Trash2 aria-hidden /> Delete
                  </Button>
                  <Button onClick={() => onEdit(item)}>
                    <Pencil aria-hidden /> Edit{item.recurrence ? " series" : ""}
                  </Button>
                </>
              ) : (
                source.path && (
                  <Button asChild>
                    <Link to={source.path}>
                      <ExternalLink aria-hidden /> Open in {source.module}
                    </Link>
                  </Button>
                )
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
