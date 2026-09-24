import {
  BellRing,
  CalendarDays,
  ChartColumn,
  ChartPie,
  FolderLock,
  HandCoins,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  NotebookPen,
  PiggyBank,
  Receipt,
  ReceiptText,
  Settings,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** Highest completed build phase; modules with phase <= this are live (not placeholders). */
export const CURRENT_PHASE = 6;

export function isLive(item: { phase: number | null }) {
  return item.phase !== null && item.phase <= CURRENT_PHASE;
}

export interface NavItem {
  title: string;
  path: string;
  icon: LucideIcon;
  description: string;
  /** Build phase in which the module's real functionality lands (null = not yet scheduled). */
  phase: number | null;
  /** Short list of what the module will do, shown on its placeholder page. */
  planned: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        title: "Dashboard",
        path: "/dashboard",
        icon: LayoutDashboard,
        description: "Your personal and financial life at a glance.",
        phase: 3,
        planned: ["Monthly income vs. expenses", "Upcoming bills and reminders", "Pending and overdue tasks"],
      },
    ],
  },
  {
    label: "Money",
    items: [
      {
        title: "Finance",
        path: "/finance",
        icon: Wallet,
        description: "Overview of accounts, cash flow and balances.",
        phase: 4,
        planned: ["Cash-flow summary", "Category breakdowns", "Multi-currency ready (NPR default)"],
      },
      {
        title: "Income",
        path: "/income",
        icon: TrendingUp,
        description: "Record salary and other income sources.",
        phase: 4,
        planned: ["Add, edit and delete income", "Recurring monthly income", "Filter by month and source"],
      },
      {
        title: "Expenses",
        path: "/expenses",
        icon: Receipt,
        description: "Track daily spending by category.",
        phase: 4,
        planned: ["Food, transport, education, medical, shopping", "Quick add from any device", "Search and filters"],
      },
      {
        title: "Budget",
        path: "/budget",
        icon: ChartPie,
        description: "Set monthly limits and watch progress.",
        phase: 5,
        planned: ["Per-category monthly budgets", "Progress and overspend warnings"],
      },
      {
        title: "Bills",
        path: "/bills",
        icon: ReceiptText,
        description: "Rent, Wi-Fi, electricity, water, mobile and subscriptions.",
        phase: 5,
        planned: ["Room rent tracking", "Utility bills with due dates", "Subscriptions and recharges"],
      },
      {
        title: "Savings",
        path: "/savings",
        icon: PiggyBank,
        description: "Savings and financial goals.",
        phase: 5,
        planned: ["Savings balances", "Goal targets and progress"],
      },
      {
        title: "Debts",
        path: "/debts",
        icon: HandCoins,
        description: "Loans you owe and money owed to you.",
        // Not part of any scheduled phase yet; loan repayments can be tracked as "Loan" bills.
        phase: null,
        planned: ["Loan tracking", "Repayment history", "Outstanding balances"],
      },
    ],
  },
  {
    label: "Planner",
    items: [
      {
        title: "Tasks",
        path: "/tasks",
        icon: ListChecks,
        description: "Daily, pending and overdue tasks.",
        phase: 6,
        planned: ["Create and complete tasks", "Pending and overdue views", "Priorities and due dates"],
      },
      {
        title: "Reminders",
        path: "/reminders",
        icon: BellRing,
        description: "Never miss a payment or deadline.",
        phase: 6,
        planned: ["One-time and recurring reminders", "Linked to bills and tasks"],
      },
      {
        title: "Calendar",
        path: "/calendar",
        icon: CalendarDays,
        description: "Reminders, bills and tasks on a calendar.",
        phase: 9,
        planned: ["Month and week views", "Bills, tasks and reminders together"],
      },
    ],
  },
  {
    label: "Vault",
    items: [
      {
        title: "Password Vault",
        path: "/vault",
        icon: KeyRound,
        description: "Encrypted storage for passwords and secrets.",
        phase: 7,
        planned: ["AES-256-GCM encrypted entries", "Hidden by default, reveal on demand", "Password generator"],
      },
      {
        title: "Notes",
        path: "/notes",
        icon: NotebookPen,
        description: "Private notes and personal records.",
        phase: 8,
        planned: ["Rich notes", "Tags and search", "Pin important notes"],
      },
      {
        title: "Documents",
        path: "/documents",
        icon: FolderLock,
        description: "Store important private documents.",
        phase: 8,
        planned: ["Secure file uploads", "Categories and search", "Safe downloads"],
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        title: "Reports",
        path: "/reports",
        icon: ChartColumn,
        description: "Financial reports and analytics.",
        phase: 10,
        planned: ["Monthly and yearly reports", "Spending trends", "Export to CSV"],
      },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = {
  title: "Settings",
  path: "/settings",
  icon: Settings,
  description: "Account, security, preferences and data export.",
  phase: 12,
  planned: ["Profile and password", "Currency and preferences", "Export personal data"],
};

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];

export function findNavItem(path: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((item) => item.path === path);
}

/** Titles for app pages that aren't top-level navigation items. */
const EXTRA_PAGE_TITLES: Record<string, string> = {
  "/settings/password": "Change password",
};

export function pageTitle(path: string): string {
  return findNavItem(path)?.title ?? EXTRA_PAGE_TITLES[path] ?? "LifeVault";
}

/** Primary destinations shown in the mobile bottom bar. */
export const MOBILE_PRIMARY_PATHS = ["/dashboard", "/expenses", "/tasks", "/calendar"];
