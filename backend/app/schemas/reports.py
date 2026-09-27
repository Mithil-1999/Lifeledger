"""Response models for financial reports. Money is sent as exact decimal strings."""

import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel

from app.schemas.common import DecimalStr, PercentStr
from app.schemas.planning import SavingsGoalOut


class ReportPeriodOut(BaseModel):
    kind: Literal["month", "year", "range"]
    start: date
    end: date
    label: str
    trend_start: date
    months: list[str]
    trend_months: list[str]


class Change(BaseModel):
    amount: DecimalStr
    # None when the previous value was zero (a change from nothing has no percentage).
    percent: PercentStr | None


# --- Finance -------------------------------------------------------------------------------------------


class FinanceMonth(BaseModel):
    month: str
    income: DecimalStr
    expenses: DecimalStr
    net: DecimalStr
    savings: DecimalStr
    balance: DecimalStr | None


class FinanceTotals(BaseModel):
    income: DecimalStr
    expenses: DecimalStr
    net: DecimalStr
    savings_rate: PercentStr | None
    savings_deposits: DecimalStr
    savings_withdrawals: DecimalStr
    savings: DecimalStr
    closing_balance: DecimalStr | None
    balance_as_of: date | None


class FinanceReport(BaseModel):
    currency: str
    period: ReportPeriodOut
    totals: FinanceTotals
    months: list[FinanceMonth]


# --- Expenses --------------------------------------------------------------------------------------------


class ExpenseCategoryRow(BaseModel):
    category_id: uuid.UUID
    category: str
    amount: DecimalStr
    count: int
    percent: PercentStr | None
    previous_amount: DecimalStr
    change: Change


class ExpenseRow(BaseModel):
    id: uuid.UUID
    date: date
    category: str
    description: str | None
    amount: DecimalStr
    payment_method: str
    is_recurring: bool
    recurrence_interval: str | None


class RecurringGroup(BaseModel):
    category: str
    description: str | None
    interval: str | None
    count: int
    total: DecimalStr
    last_amount: DecimalStr
    last_date: date


class RecurringExpenses(BaseModel):
    total: DecimalStr
    count: int
    percent_of_total: PercentStr | None
    items: list[RecurringGroup]


class PreviousPeriod(BaseModel):
    start: date
    end: date
    total: DecimalStr
    change: Change


class MonthAmount(BaseModel):
    month: str
    amount: DecimalStr


class MonthAmountChange(MonthAmount):
    change: Change | None


class ExpenseReport(BaseModel):
    currency: str
    period: ReportPeriodOut
    category_id: uuid.UUID | None
    total: DecimalStr
    count: int
    previous: PreviousPeriod
    by_category: list[ExpenseCategoryRow]
    largest: list[ExpenseRow]
    recurring: RecurringExpenses
    monthly: list[MonthAmountChange]


# --- Budget -----------------------------------------------------------------------------------------------


class BudgetMonthRow(BaseModel):
    month: str
    budget: DecimalStr
    spent: DecimalStr
    remaining: DecimalStr
    percent_used: PercentStr | None
    budgeted_categories: int
    over_budget: int
    unbudgeted_spent: DecimalStr | None


class BudgetCategoryRow(BaseModel):
    category_id: uuid.UUID
    category: str
    budget: DecimalStr
    spent: DecimalStr
    remaining: DecimalStr
    percent_used: PercentStr | None
    months_budgeted: int
    months_over: int


class BudgetTotals(BaseModel):
    budget: DecimalStr
    spent: DecimalStr
    remaining: DecimalStr
    percent_used: PercentStr | None
    unbudgeted_spent: DecimalStr | None


class BudgetReport(BaseModel):
    currency: str
    period: ReportPeriodOut
    category_id: uuid.UUID | None
    whole_months: bool
    totals: BudgetTotals
    months: list[BudgetMonthRow]
    categories: list[BudgetCategoryRow]


# --- Savings ------------------------------------------------------------------------------------------------


class SavingsMonth(BaseModel):
    month: str
    deposits: DecimalStr
    withdrawals: DecimalStr
    net: DecimalStr
    total_saved: DecimalStr | None


class SavingsGoalReport(SavingsGoalOut):
    saved_in_period: DecimalStr


class SavingsTotals(BaseModel):
    deposits: DecimalStr
    withdrawals: DecimalStr
    net: DecimalStr
    total_saved: DecimalStr
    total_target: DecimalStr
    progress_percent: PercentStr | None
    goals: int
    completed_goals: int


class SavingsReport(BaseModel):
    currency: str
    period: ReportPeriodOut
    totals: SavingsTotals
    months: list[SavingsMonth]
    goals: list[SavingsGoalReport]


# --- Bills ----------------------------------------------------------------------------------------------------


class PaidByBill(BaseModel):
    bill_id: uuid.UUID
    name: str
    category: str
    count: int
    total: DecimalStr


class CategoryTotal(BaseModel):
    category: str
    total: DecimalStr


class PaidBills(BaseModel):
    total: DecimalStr
    count: int
    by_bill: list[PaidByBill]
    by_category: list[CategoryTotal]


class BillBrief(BaseModel):
    id: uuid.UUID
    name: str
    category: str
    amount: DecimalStr
    due_date: date
    frequency: str
    days_until_due: int


class BillGroup(BaseModel):
    total: DecimalStr
    count: int
    items: list[BillBrief]


class FrequencyTotal(BaseModel):
    frequency: str
    count: int
    per_cycle: DecimalStr
    per_year: DecimalStr


class RecurringBills(BaseModel):
    count: int
    by_frequency: list[FrequencyTotal]
    yearly_total: DecimalStr
    # yearly_total / 12, an average (weekly bills count as 52 a year).
    monthly_average: DecimalStr


class BillsReport(BaseModel):
    currency: str
    period: ReportPeriodOut
    category: str | None
    today: date
    paid: PaidBills
    pending: BillGroup
    overdue: BillGroup
    recurring: RecurringBills
    monthly_paid: list[MonthAmount]
