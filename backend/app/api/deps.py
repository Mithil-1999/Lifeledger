"""Shared FastAPI dependencies, including authentication guards.

Protect a route by depending on `CurrentUser` (or attaching it to a router via
`dependencies=[Depends(get_current_user)]`). Unauthenticated requests get 401.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.models import User, UserSession
from app.services.auth import get_valid_session

DbSession = Annotated[Session, Depends(get_db)]

_UNAUTHENTICATED = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")


def get_optional_session(request: Request, db: DbSession) -> UserSession | None:
    token = request.cookies.get(get_settings().session_cookie_name)
    if not token or len(token) > 200:
        return None
    return get_valid_session(db, token)


def get_current_session(session: Annotated[UserSession | None, Depends(get_optional_session)]) -> UserSession:
    if session is None:
        raise _UNAUTHENTICATED
    return session


def get_current_user(session: Annotated[UserSession, Depends(get_current_session)]) -> User:
    return session.user


CurrentSession = Annotated[UserSession, Depends(get_current_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]
