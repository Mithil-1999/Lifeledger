import * as React from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import type { Category, SortOption } from "./api";
import type { FilterState } from "./filters";
import { PAYMENT_METHOD_LABELS } from "./constants";

interface LedgerFiltersProps {
  kind: string;
  value: FilterState;
  onChange: (next: Partial<FilterState>) => void;
  onReset: () => void;
  categories: Category[] | undefined;
}

/** Search box (debounced) plus category, payment method, month, recurrence and sort filters. */
export function LedgerFilters({ kind, value, onChange, onReset, categories }: LedgerFiltersProps) {
  const [search, setSearch] = React.useState(value.search);
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Keep the box in sync when filters are reset or changed from the URL
  // (adjusting state during render, as React recommends, instead of in an effect).
  const [syncedSearch, setSyncedSearch] = React.useState(value.search);
  if (value.search !== syncedSearch) {
    setSyncedSearch(value.search);
    setSearch(value.search);
  }

  React.useEffect(() => {
    if (search === value.search) return;
    const timer = window.setTimeout(() => onChangeRef.current({ search }), 300);
    return () => window.clearTimeout(timer);
  }, [search, value.search]);

  const active =
    value.search || value.category_id || value.payment_method || value.month || value.is_recurring || value.sort !== "date_desc";
  const id = (name: string) => `${kind}-filter-${name}`;

  return (
    <div className="grid gap-3 rounded-xl border bg-card p-3 sm:p-4" role="search" aria-label={`Filter ${kind}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          aria-label="Search"
          placeholder="Search description, notes, category…"
          className="pl-9"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="grid gap-1">
          <Label htmlFor={id("category")} className="text-xs text-muted-foreground">Category</Label>
          <NativeSelect id={id("category")} value={value.category_id} onChange={(e) => onChange({ category_id: e.target.value })}>
            <option value="">All categories</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={id("method")} className="text-xs text-muted-foreground">Payment method</Label>
          <NativeSelect id={id("method")} value={value.payment_method} onChange={(e) => onChange({ payment_method: e.target.value })}>
            <option value="">All methods</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={id("month")} className="text-xs text-muted-foreground">Month</Label>
          <Input id={id("month")} type="month" value={value.month} onChange={(e) => onChange({ month: e.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={id("recurring")} className="text-xs text-muted-foreground">Recurring</Label>
          <NativeSelect id={id("recurring")} value={value.is_recurring} onChange={(e) => onChange({ is_recurring: e.target.value })}>
            <option value="">All</option>
            <option value="true">Recurring only</option>
            <option value="false">One-time only</option>
          </NativeSelect>
        </div>
        <div className="col-span-2 grid gap-1 lg:col-span-1">
          <Label htmlFor={id("sort")} className="text-xs text-muted-foreground">Sort by</Label>
          <NativeSelect id={id("sort")} value={value.sort} onChange={(e) => onChange({ sort: e.target.value as SortOption })}>
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="amount_desc">Largest amount</option>
            <option value="amount_asc">Smallest amount</option>
          </NativeSelect>
        </div>
      </div>
      {active && (
        <div>
          <Button variant="ghost" size="sm" onClick={onReset}>
            <X aria-hidden /> Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
