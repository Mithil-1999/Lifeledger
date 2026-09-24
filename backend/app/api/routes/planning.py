"""Budgets, bills and savings goals. All routes require a signed-in user and only touch
that user's data (other users' records return 404)."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.models import BillCategory
from app.schemas.planning import (
    BillIn,
    BillOut,
    BillPaymentOut,
    BillPayRequest,
    BillsOverview,
    BudgetCopyRequest,
    BudgetCopyResult,
    BudgetCreate,
    BudgetMonth,
    BudgetOut,
    BudgetUpdate,
    ContributionIn,
    ContributionOut,
    EffectiveBillStatus,
    SavingsGoalIn,
    SavingsGoalOut,
    SavingsOverview,
    _check_year_month,
)
from app.services import bills as bill_service
from app.services import budgets as budget_service
from app.services import savings as savings_service
from app.services.dashboard import current_period

router = APIRouter()


def _today():
    return current_period().today


def _http(exc: Exception) -> HTTPException:
    return HTTPException(status_code=getattr(exc, "status_code", 400), detail=str(exc))


# --- Budgets -------------------------------------------------------------------------------------


@router.get("/budgets", response_model=BudgetMonth, tags=["budgets"])
def get_budgets(user: CurrentUser, db: DbSession, month: Annotated[str | None, Query()] = None) -> Any:
    year_month = month or _today().strftime("%Y-%m")
    try:
        _check_year_month(year_month)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return budget_service.budget_month(db, user.id, year_month)


@router.post("/budgets", response_model=BudgetOut, status_code=status.HTTP_201_CREATED, tags=["budgets"])
def create_budget(payload: BudgetCreate, user: CurrentUser, db: DbSession) -> Any:
    try:
        budget = budget_service.create_budget(
            db, user.id, payload.category_id, payload.month, payload.amount, payload.warning_threshold
        )
    except budget_service.BudgetError as exc:
        raise _http(exc) from None
    return budget_service.find_row(db, user.id, budget)


@router.put("/budgets/{budget_id}", response_model=BudgetOut, tags=["budgets"])
def update_budget(budget_id: uuid.UUID, payload: BudgetUpdate, user: CurrentUser, db: DbSession) -> Any:
    try:
        budget = budget_service.update_budget(db, user.id, budget_id, payload.amount, payload.warning_threshold)
    except budget_service.BudgetError as exc:
        raise _http(exc) from None
    return budget_service.find_row(db, user.id, budget)


@router.delete("/budgets/{budget_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["budgets"])
def delete_budget(budget_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    try:
        budget_service.delete_budget(db, user.id, budget_id)
    except budget_service.BudgetError as exc:
        raise _http(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/budgets/copy", response_model=BudgetCopyResult, tags=["budgets"])
def copy_budgets(payload: BudgetCopyRequest, user: CurrentUser, db: DbSession) -> Any:
    try:
        copied, skipped = budget_service.copy_budgets(db, user.id, payload.from_month, payload.to_month)
    except budget_service.BudgetError as exc:
        raise _http(exc) from None
    return {"copied": copied, "skipped": skipped}


# --- Bills -----------------------------------------------------------------------------------------


@router.get("/bills", response_model=BillsOverview, tags=["bills"])
def list_bills(
    user: CurrentUser,
    db: DbSession,
    status_filter: Annotated[EffectiveBillStatus | None, Query(alias="status")] = None,
    category: BillCategory | None = None,
) -> Any:
    return bill_service.overview(db, user.id, _today(), status_filter, category.value if category else None)


@router.post("/bills", response_model=BillOut, status_code=status.HTTP_201_CREATED, tags=["bills"])
def create_bill(payload: BillIn, user: CurrentUser, db: DbSession) -> Any:
    try:
        bill = bill_service.create_bill(db, user.id, payload.model_dump())
    except bill_service.BillError as exc:
        raise _http(exc) from None
    return bill_service.bill_out(db, user.id, bill, _today())


@router.get("/bills/{bill_id}", response_model=BillOut, tags=["bills"])
def get_bill(bill_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Any:
    try:
        return bill_service.bill_out(db, user.id, bill_service.get_bill(db, user.id, bill_id), _today())
    except bill_service.BillError as exc:
        raise _http(exc) from None


@router.put("/bills/{bill_id}", response_model=BillOut, tags=["bills"])
def update_bill(bill_id: uuid.UUID, payload: BillIn, user: CurrentUser, db: DbSession) -> Any:
    try:
        bill = bill_service.update_bill(db, user.id, bill_id, payload.model_dump())
    except bill_service.BillError as exc:
        raise _http(exc) from None
    return bill_service.bill_out(db, user.id, bill, _today())


@router.delete("/bills/{bill_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["bills"])
def delete_bill(bill_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    try:
        bill_service.delete_bill(db, user.id, bill_id)
    except bill_service.BillError as exc:
        raise _http(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/bills/{bill_id}/pay", response_model=BillOut, tags=["bills"])
def pay_bill(bill_id: uuid.UUID, payload: BillPayRequest, user: CurrentUser, db: DbSession) -> Any:
    try:
        bill = bill_service.pay_bill(
            db,
            user.id,
            bill_id,
            paid_on=payload.paid_on,
            amount=payload.amount,
            record_expense=payload.record_expense,
            payment_method=payload.payment_method,
        )
    except bill_service.BillError as exc:
        raise _http(exc) from None
    return bill_service.bill_out(db, user.id, bill, _today())


@router.get("/bills/{bill_id}/payments", response_model=list[BillPaymentOut], tags=["bills"])
def bill_payments(bill_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Any:
    try:
        return bill_service.list_payments(db, user.id, bill_id)
    except bill_service.BillError as exc:
        raise _http(exc) from None


# --- Savings goals -----------------------------------------------------------------------------------


@router.get("/savings-goals", response_model=SavingsOverview, tags=["savings"])
def list_goals(user: CurrentUser, db: DbSession) -> Any:
    return savings_service.overview(db, user.id, _today())


@router.post("/savings-goals", response_model=SavingsGoalOut, status_code=status.HTTP_201_CREATED, tags=["savings"])
def create_goal(payload: SavingsGoalIn, user: CurrentUser, db: DbSession) -> Any:
    today = _today()
    return savings_service.goal_out(savings_service.create_goal(db, user.id, payload.model_dump(), today), today)


@router.get("/savings-goals/{goal_id}", response_model=SavingsGoalOut, tags=["savings"])
def get_goal(goal_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Any:
    try:
        return savings_service.goal_out(savings_service.get_goal(db, user.id, goal_id), _today())
    except savings_service.SavingsError as exc:
        raise _http(exc) from None


@router.put("/savings-goals/{goal_id}", response_model=SavingsGoalOut, tags=["savings"])
def update_goal(goal_id: uuid.UUID, payload: SavingsGoalIn, user: CurrentUser, db: DbSession) -> Any:
    today = _today()
    try:
        return savings_service.goal_out(savings_service.update_goal(db, user.id, goal_id, payload.model_dump(), today), today)
    except savings_service.SavingsError as exc:
        raise _http(exc) from None


@router.delete("/savings-goals/{goal_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["savings"])
def delete_goal(goal_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    try:
        savings_service.delete_goal(db, user.id, goal_id)
    except savings_service.SavingsError as exc:
        raise _http(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/savings-goals/{goal_id}/contributions", response_model=SavingsGoalOut, tags=["savings"])
def contribute(goal_id: uuid.UUID, payload: ContributionIn, user: CurrentUser, db: DbSession) -> Any:
    try:
        goal = savings_service.contribute(db, user.id, goal_id, payload.kind, payload.amount, payload.date, payload.note)
    except savings_service.SavingsError as exc:
        raise _http(exc) from None
    return savings_service.goal_out(goal, _today())


@router.get("/savings-goals/{goal_id}/contributions", response_model=list[ContributionOut], tags=["savings"])
def contributions(goal_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Any:
    try:
        return savings_service.list_contributions(db, user.id, goal_id)
    except savings_service.SavingsError as exc:
        raise _http(exc) from None
