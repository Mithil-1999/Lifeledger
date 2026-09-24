"""Category lookups and custom-category management (always scoped to one user)."""

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Category, Expense, Income

LEDGER_MODELS = {"income": Income, "expense": Expense}


class CategoryError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def visible_to(user_id: uuid.UUID):
    """Built-in categories plus the user's own custom ones."""
    return or_(Category.user_id.is_(None), Category.user_id == user_id)


def list_categories(db: Session, user_id: uuid.UUID, kind: str | None = None) -> list[Category]:
    stmt = select(Category).where(visible_to(user_id))
    if kind:
        stmt = stmt.where(Category.kind == kind)
    # Built-ins first ("Other" last among them), then custom categories alphabetically.
    stmt = stmt.order_by(
        Category.kind,
        Category.is_system.desc(),
        (Category.slug == "other").asc(),
        func.lower(Category.name),
    )
    return list(db.scalars(stmt))


def get_usable_category(db: Session, user_id: uuid.UUID, category_id: uuid.UUID, kind: str) -> Category:
    category = db.scalar(select(Category).where(Category.id == category_id, visible_to(user_id)))
    if category is None or category.kind != kind:
        raise CategoryError(f"Choose a valid {kind} category.", 422)
    return category


def _name_taken(db: Session, user_id: uuid.UUID, kind: str, name: str, exclude_id: uuid.UUID | None = None) -> bool:
    stmt = select(Category.id).where(visible_to(user_id), Category.kind == kind, func.lower(Category.name) == name.lower())
    if exclude_id is not None:
        stmt = stmt.where(Category.id != exclude_id)
    return db.scalar(stmt) is not None


def create_category(db: Session, user_id: uuid.UUID, kind: str, name: str) -> Category:
    if _name_taken(db, user_id, kind, name):
        raise CategoryError(f'A {kind} category named "{name}" already exists.', 409)
    category = Category(user_id=user_id, kind=kind, name=name, is_system=False)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


def _own_custom_category(db: Session, user_id: uuid.UUID, category_id: uuid.UUID) -> Category:
    category = db.scalar(select(Category).where(Category.id == category_id, visible_to(user_id)))
    if category is None:
        raise CategoryError("Category not found.", 404)
    if category.is_system:
        raise CategoryError("Built-in categories can't be changed.", 403)
    return category


def rename_category(db: Session, user_id: uuid.UUID, category_id: uuid.UUID, name: str) -> Category:
    category = _own_custom_category(db, user_id, category_id)
    if _name_taken(db, user_id, category.kind, name, exclude_id=category.id):
        raise CategoryError(f'A {category.kind} category named "{name}" already exists.', 409)
    category.name = name
    db.commit()
    db.refresh(category)
    return category


def delete_category(db: Session, user_id: uuid.UUID, category_id: uuid.UUID) -> None:
    category = _own_custom_category(db, user_id, category_id)
    model = LEDGER_MODELS[category.kind]
    in_use = db.scalar(select(func.count()).select_from(model).where(model.category_id == category.id))
    if in_use:
        noun = "record" if in_use == 1 else "records"
        raise CategoryError(
            f"This category is used by {in_use} {noun}. Move them to another category first.", 409
        )
    db.delete(category)
    db.commit()
