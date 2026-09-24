"""Categories, income and expense endpoints. All require an authenticated user and only
ever touch that user's data (other users' records return 404)."""

import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, DbSession
from app.models import CategoryKind, Expense, Income, PaymentMethod
from app.schemas.finance import (
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    ExpenseIn,
    ExpenseOut,
    IncomeIn,
    IncomeOut,
    LedgerSummary,
    Page,
    SortOption,
)
from app.services import categories as category_service
from app.services import ledger
from app.services.dashboard import current_period

router = APIRouter()


def _category_error(exc: category_service.CategoryError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


# --- Categories -----------------------------------------------------------------------------


@router.get("/categories", response_model=list[CategoryOut], tags=["categories"])
def list_categories(user: CurrentUser, db: DbSession, kind: CategoryKind | None = None) -> Any:
    return category_service.list_categories(db, user.id, kind.value if kind else None)


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED, tags=["categories"])
def create_category(payload: CategoryCreate, user: CurrentUser, db: DbSession) -> Any:
    try:
        return category_service.create_category(db, user.id, payload.kind.value, payload.name)
    except category_service.CategoryError as exc:
        raise _category_error(exc) from None


@router.patch("/categories/{category_id}", response_model=CategoryOut, tags=["categories"])
def rename_category(category_id: uuid.UUID, payload: CategoryUpdate, user: CurrentUser, db: DbSession) -> Any:
    try:
        return category_service.rename_category(db, user.id, category_id, payload.name)
    except category_service.CategoryError as exc:
        raise _category_error(exc) from None


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["categories"])
def delete_category(category_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    try:
        category_service.delete_category(db, user.id, category_id)
    except category_service.CategoryError as exc:
        raise _category_error(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Income & expenses (one implementation, two resources) -----------------------------------


class ListParams(BaseModel):
    search: str | None = None
    category_id: uuid.UUID | None = None
    payment_method: PaymentMethod | None = None
    date_from: date | None = None
    date_to: date | None = None
    is_recurring: bool | None = None
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    sort: SortOption = "date_desc"
    page: int = 1
    page_size: int = 25


def list_params(
    search: Annotated[str | None, Query(max_length=100)] = None,
    category_id: uuid.UUID | None = None,
    payment_method: PaymentMethod | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    is_recurring: bool | None = None,
    min_amount: Annotated[Decimal | None, Query(ge=0, max_digits=14, decimal_places=2)] = None,
    max_amount: Annotated[Decimal | None, Query(ge=0, max_digits=14, decimal_places=2)] = None,
    sort: SortOption = "date_desc",
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> ListParams:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from must be on or before date_to.")
    return ListParams(
        search=search or None,
        category_id=category_id,
        payment_method=payment_method,
        date_from=date_from,
        date_to=date_to,
        is_recurring=is_recurring,
        min_amount=min_amount,
        max_amount=max_amount,
        sort=sort,
        page=page,
        page_size=page_size,
    )


def _register_ledger_routes(prefix: str, model, in_schema: type[BaseModel], out_schema: type[BaseModel], noun: str) -> None:
    tag = prefix.strip("/")

    @router.get(prefix, response_model=Page[out_schema], tags=[tag], name=f"list_{tag}")
    def list_entries(user: CurrentUser, db: DbSession, params: Annotated[ListParams, Depends(list_params)]) -> Any:
        filters = ledger.LedgerFilters(
            search=params.search,
            category_id=params.category_id,
            payment_method=params.payment_method.value if params.payment_method else None,
            date_from=params.date_from,
            date_to=params.date_to,
            is_recurring=params.is_recurring,
            min_amount=params.min_amount,
            max_amount=params.max_amount,
        )
        items, count, total, currency = ledger.list_records(
            db, model, user.id, filters, sort=params.sort, page=params.page, page_size=params.page_size
        )
        return {
            "items": items,
            "total_count": count,
            "total_amount": total,
            "currency": currency,
            "page": params.page,
            "page_size": params.page_size,
        }

    @router.get(f"{prefix}/summary", response_model=LedgerSummary, tags=[tag], name=f"{tag}_summary")
    def summary(user: CurrentUser, db: DbSession, year: Annotated[int | None, Query(ge=2000, le=2100)] = None) -> Any:
        period = current_period()
        current_month = period.start.strftime("%Y-%m")
        return ledger.year_summary(db, model, user.id, year or period.today.year, current_month)

    @router.post(prefix, response_model=out_schema, status_code=status.HTTP_201_CREATED, tags=[tag], name=f"create_{tag}")
    def create_entry(payload: in_schema, user: CurrentUser, db: DbSession) -> Any:  # type: ignore[valid-type]
        try:
            return ledger.create_record(db, model, user.id, payload.model_dump())
        except category_service.CategoryError as exc:
            raise _category_error(exc) from None

    @router.get(f"{prefix}/{{record_id}}", response_model=out_schema, tags=[tag], name=f"get_{tag}")
    def get_entry(record_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Any:
        try:
            return ledger.get_record(db, model, user.id, record_id)
        except ledger.NotFoundError:
            raise HTTPException(status_code=404, detail=f"{noun} not found.") from None

    @router.put(f"{prefix}/{{record_id}}", response_model=out_schema, tags=[tag], name=f"update_{tag}")
    def update_entry(record_id: uuid.UUID, payload: in_schema, user: CurrentUser, db: DbSession) -> Any:  # type: ignore[valid-type]
        try:
            return ledger.update_record(db, model, user.id, record_id, payload.model_dump())
        except ledger.NotFoundError:
            raise HTTPException(status_code=404, detail=f"{noun} not found.") from None
        except category_service.CategoryError as exc:
            raise _category_error(exc) from None

    @router.delete(f"{prefix}/{{record_id}}", status_code=status.HTTP_204_NO_CONTENT, tags=[tag], name=f"delete_{tag}")
    def delete_entry(record_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
        try:
            ledger.delete_record(db, model, user.id, record_id)
        except ledger.NotFoundError:
            raise HTTPException(status_code=404, detail=f"{noun} not found.") from None
        return Response(status_code=status.HTTP_204_NO_CONTENT)


_register_ledger_routes("/incomes", Income, IncomeIn, IncomeOut, "Income")
_register_ledger_routes("/expenses", Expense, ExpenseIn, ExpenseOut, "Expense")
