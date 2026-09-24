import type { SortOption } from "./api";

export interface FilterState {
  search: string;
  category_id: string;
  payment_method: string;
  month: string; // "YYYY-MM" or ""
  is_recurring: string; // "", "true", "false"
  sort: SortOption;
}

export const EMPTY_FILTERS: FilterState = {
  search: "",
  category_id: "",
  payment_method: "",
  month: "",
  is_recurring: "",
  sort: "date_desc",
};
