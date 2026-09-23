import { Navigate, type RouteObject } from "react-router";
import { AppLayout } from "@/components/layout/app-layout";
import { BillsPage } from "@/pages/bills-page";
import { BudgetPage } from "@/pages/budget-page";
import { CalendarPage } from "@/pages/calendar-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { DebtsPage } from "@/pages/debts-page";
import { DocumentsPage } from "@/pages/documents-page";
import { ExpensesPage } from "@/pages/expenses-page";
import { FinancePage } from "@/pages/finance-page";
import { IncomePage } from "@/pages/income-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { NotesPage } from "@/pages/notes-page";
import { RemindersPage } from "@/pages/reminders-page";
import { ReportsPage } from "@/pages/reports-page";
import { RouteErrorPage } from "@/pages/route-error-page";
import { SavingsPage } from "@/pages/savings-page";
import { SettingsPage } from "@/pages/settings-page";
import { TasksPage } from "@/pages/tasks-page";
import { VaultPage } from "@/pages/vault-page";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "finance", element: <FinancePage /> },
      { path: "income", element: <IncomePage /> },
      { path: "expenses", element: <ExpensesPage /> },
      { path: "budget", element: <BudgetPage /> },
      { path: "bills", element: <BillsPage /> },
      { path: "savings", element: <SavingsPage /> },
      { path: "debts", element: <DebtsPage /> },
      { path: "tasks", element: <TasksPage /> },
      { path: "reminders", element: <RemindersPage /> },
      { path: "calendar", element: <CalendarPage /> },
      { path: "vault", element: <VaultPage /> },
      { path: "notes", element: <NotesPage /> },
      { path: "documents", element: <DocumentsPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
