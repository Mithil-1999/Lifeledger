"""ORM models.

Import every model module here so `Base.metadata` is fully populated for Alembic.
"""

from app.db.base import Base
from app.models.finance import Category, CategoryKind, Expense, Income, PaymentMethod, RecurrenceInterval
from app.models.planning import (
    BILL_EXPENSE_CATEGORY,
    Bill,
    BillCategory,
    BillFrequency,
    BillPayment,
    BillStatus,
    Budget,
    SavingsContribution,
    SavingsGoal,
)
from app.models.productivity import (
    OPEN_TASK_STATUSES,
    PRIORITY_RANK,
    IntervalUnit,
    Reminder,
    ReminderRepeat,
    ReminderStatus,
    Task,
    TaskPriority,
    TaskRecurrence,
    TaskStatus,
)
from app.models.records import Document, DocumentCategory, Note, NoteCategory
from app.models.user import PasswordResetToken, User, UserSession, UserStatus
from app.models.vault import VaultAction, VaultAuditLog, VaultCategory, VaultEntry, VaultKey

__all__ = [
    "VaultAction",
    "VaultAuditLog",
    "VaultCategory",
    "VaultEntry",
    "VaultKey",
    "Document",
    "DocumentCategory",
    "Note",
    "NoteCategory",
    "OPEN_TASK_STATUSES",
    "PRIORITY_RANK",
    "IntervalUnit",
    "Reminder",
    "ReminderRepeat",
    "ReminderStatus",
    "Task",
    "TaskPriority",
    "TaskRecurrence",
    "TaskStatus",
    "BILL_EXPENSE_CATEGORY",
    "Base",
    "Bill",
    "BillCategory",
    "BillFrequency",
    "BillPayment",
    "BillStatus",
    "Budget",
    "SavingsContribution",
    "SavingsGoal",
    "Category",
    "CategoryKind",
    "Expense",
    "Income",
    "PasswordResetToken",
    "PaymentMethod",
    "RecurrenceInterval",
    "User",
    "UserSession",
    "UserStatus",
]
