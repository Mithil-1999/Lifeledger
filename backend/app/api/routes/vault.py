"""Password vault API.

All routes require a signed-in user; everything except status/unlock/lock also requires the
vault to be unlocked for this session (423 otherwise). There is deliberately no endpoint
that returns more than one password: `POST /vault/entries/{id}/reveal` returns exactly one,
is audited, and is never cached.
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Request, Response, status

from app.api.deps import CurrentSession, CurrentUser, DbSession
from app.core import rate_limit
from app.core.config import get_settings
from app.core.vault_crypto import VaultCryptoError, VaultNotConfiguredError
from app.models import VaultCategory
from app.schemas.vault import (
    AuditEntry,
    FavoriteIn,
    RevealIn,
    RevealOut,
    UnlockIn,
    VaultEntryDetail,
    VaultEntryIn,
    VaultEntryList,
    VaultEntryOut,
    VaultStatus,
)
from app.services import vault as vault_service

router = APIRouter(prefix="/vault", tags=["vault"])

UNLOCK_LIMIT = rate_limit.Limit(5, 15 * 60)


def _ctx(request: Request) -> dict[str, str | None]:
    return {"ip": rate_limit.client_ip(request), "user_agent": request.headers.get("user-agent")}


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def _guard(session) -> None:
    if get_settings().vault_master_key is None:
        raise HTTPException(status_code=503, detail="The password vault isn't configured on this server.")
    try:
        vault_service.require_unlocked(session)
    except vault_service.VaultError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from None


def _call(fn, *args, **kwargs):
    """Map service/crypto failures to safe HTTP errors (no secret or crypto detail leaks)."""
    try:
        return fn(*args, **kwargs)
    except vault_service.VaultError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from None
    except VaultNotConfiguredError:
        raise HTTPException(status_code=503, detail="The password vault isn't configured on this server.") from None
    except VaultCryptoError:
        raise HTTPException(status_code=500, detail="This vault entry couldn't be decrypted.") from None


# --- Lock state -------------------------------------------------------------------------------------------------


@router.get("/status", response_model=VaultStatus)
def status_(session: CurrentSession, response: Response) -> Any:
    _no_store(response)
    unlocked = vault_service.is_unlocked(session)
    return {
        "configured": get_settings().vault_master_key is not None,
        "unlocked": unlocked,
        "unlocked_until": session.vault_unlocked_until if unlocked else None,
        "unlock_minutes": get_settings().vault_unlock_minutes,
    }


@router.post("/unlock", response_model=VaultStatus)
def unlock(payload: UnlockIn, request: Request, response: Response, user: CurrentUser, session: CurrentSession, db: DbSession) -> Any:
    """Re-enter your account password to open the vault for VAULT_UNLOCK_MINUTES."""
    if get_settings().vault_master_key is None:
        raise HTTPException(status_code=503, detail="The password vault isn't configured on this server.")
    rate_limit.enforce("vault-unlock:user", str(user.id), UNLOCK_LIMIT)
    until = _call(vault_service.unlock, db, user, session, payload.password.get_secret_value(), **_ctx(request))
    _no_store(response)
    return {"configured": True, "unlocked": True, "unlocked_until": until, "unlock_minutes": get_settings().vault_unlock_minutes}


@router.post("/lock", status_code=status.HTTP_204_NO_CONTENT)
def lock(request: Request, user: CurrentUser, session: CurrentSession, db: DbSession) -> Response:
    vault_service.lock(db, user, session, **_ctx(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Entries -------------------------------------------------------------------------------------------------------------


@router.get("/entries", response_model=VaultEntryList)
def list_entries(
    user: CurrentUser,
    session: CurrentSession,
    db: DbSession,
    response: Response,
    search: Annotated[str | None, Query(max_length=100)] = None,
    category: VaultCategory | None = None,
    favorites: bool = False,
) -> Any:
    _guard(session)
    _no_store(response)
    return _call(vault_service.list_entries, db, user.id, search=search or None, category=category.value if category else None, favorites=favorites)


@router.post("/entries", response_model=VaultEntryDetail, status_code=status.HTTP_201_CREATED)
def create_entry(payload: VaultEntryIn, request: Request, response: Response, user: CurrentUser, session: CurrentSession, db: DbSession) -> Any:
    _guard(session)
    _no_store(response)
    data = payload.model_dump()
    data["password"] = payload.password.get_secret_value() if payload.password else None
    return _call(vault_service.create_entry, db, user.id, data, **_ctx(request))


@router.get("/entries/{entry_id}", response_model=VaultEntryDetail)
def get_entry(entry_id: uuid.UUID, response: Response, user: CurrentUser, session: CurrentSession, db: DbSession) -> Any:
    _guard(session)
    _no_store(response)
    return _call(vault_service.entry_detail, db, user.id, entry_id)


@router.put("/entries/{entry_id}", response_model=VaultEntryDetail)
def update_entry(entry_id: uuid.UUID, payload: VaultEntryIn, request: Request, response: Response, user: CurrentUser, session: CurrentSession, db: DbSession) -> Any:
    _guard(session)
    _no_store(response)
    data = payload.model_dump()
    data["password"] = payload.password.get_secret_value() if payload.password else None
    return _call(vault_service.update_entry, db, user.id, entry_id, data, **_ctx(request))


@router.patch("/entries/{entry_id}/favorite", response_model=VaultEntryOut)
def set_favorite(entry_id: uuid.UUID, payload: FavoriteIn, response: Response, user: CurrentUser, session: CurrentSession, db: DbSession) -> Any:
    _guard(session)
    _no_store(response)
    return _call(vault_service.set_favorite, db, user.id, entry_id, payload.is_favorite)


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: uuid.UUID, request: Request, user: CurrentUser, session: CurrentSession, db: DbSession) -> Response:
    _guard(session)
    _call(vault_service.delete_entry, db, user.id, entry_id, **_ctx(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/entries/{entry_id}/reveal", response_model=RevealOut)
def reveal(entry_id: uuid.UUID, payload: RevealIn, request: Request, response: Response, user: CurrentUser, session: CurrentSession, db: DbSession) -> Any:
    """Decrypt ONE password, for display or copying. Audited; never cached."""
    _guard(session)
    _no_store(response)
    response.headers["Pragma"] = "no-cache"
    return {"password": _call(vault_service.reveal_password, db, user.id, entry_id, payload.purpose, **_ctx(request))}


# --- Audit --------------------------------------------------------------------------------------------------------------------


@router.get("/audit", response_model=list[AuditEntry])
def audit_log(user: CurrentUser, session: CurrentSession, db: DbSession, response: Response, limit: Annotated[int, Query(ge=1, le=200)] = 50) -> Any:
    _guard(session)
    _no_store(response)
    return vault_service.audit_log(db, user.id, limit)
