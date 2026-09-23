"""Authentication business logic: accounts, sessions and password resets."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import (
    generate_token,
    hash_password,
    hash_token,
    password_needs_rehash,
    password_policy_errors,
    verify_dummy_password,
    verify_password,
)
from app.models import PasswordResetToken, User, UserSession
from app.services.email import OutgoingEmail

# Only touch last_seen_at this often, to avoid a write on every request.
LAST_SEEN_RESOLUTION = timedelta(seconds=60)


class AuthError(Exception):
    """Raised with a message that is safe to show to the user."""


class DuplicateAccountError(AuthError):
    def __init__(self, field: str) -> None:
        self.field = field
        super().__init__(f"An account with this {field} already exists.")


def utcnow() -> datetime:
    return datetime.now(UTC)


# --- Accounts ------------------------------------------------------------------------


def _check_password_policy(user: User, password: str) -> None:
    problems = password_policy_errors(password, username=user.username, email=user.email, name=user.name)
    if problems:
        raise AuthError(" ".join(problems))


def register_user(db: Session, *, name: str, username: str, email: str, password: str) -> User:
    for field, value in (("email", email), ("username", username)):
        column = getattr(User, field)
        if db.scalar(select(User.id).where(column == value)):
            raise DuplicateAccountError(field)

    user = User(name=name, username=username, email=email, password_hash=hash_password(password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:  # Concurrent registration raced past the checks above.
        db.rollback()
        field = "email" if "email" in str(exc.orig) else "username"
        raise DuplicateAccountError(field) from None
    db.refresh(user)
    return user


def authenticate(db: Session, *, identifier: str, password: str) -> User | None:
    """Return the user if the credentials are valid and the account is active, else None.

    Unknown accounts still run a full hash verification so timing is uniform.
    """
    normalized = identifier.strip().lower()
    user = db.scalar(select(User).where(or_(User.email == normalized, User.username == normalized)))
    if user is None:
        verify_dummy_password(password)
        return None
    if not verify_password(user.password_hash, password) or not user.is_active:
        return None
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    user.last_login_at = utcnow()
    db.commit()
    return user


def change_password(db: Session, *, user: User, current_session: UserSession, current: str, new: str) -> str:
    """Update the password, revoke every other session and rotate the current one.

    Returns the new session token for the current device.
    """
    if not verify_password(user.password_hash, current):
        raise AuthError("Current password is incorrect.")
    _check_password_policy(user, new)
    user.password_hash = hash_password(new)
    user.password_changed_at = utcnow()
    revoke_all_sessions(db, user_id=user.id, except_session_id=current_session.id, commit=False)
    token = generate_token()
    current_session.token_hash = hash_token(token)
    db.commit()
    return token


# --- Sessions ------------------------------------------------------------------------


@dataclass(frozen=True)
class NewSession:
    token: str
    session: UserSession
    persistent: bool

    @property
    def max_age_seconds(self) -> int | None:
        """Cookie Max-Age: persistent for "remember me", browser-session cookie otherwise."""
        if not self.persistent:
            return None
        return int((self.session.expires_at - utcnow()).total_seconds())


def create_session(
    db: Session, *, user: User, remember_me: bool, user_agent: str | None, ip_address: str | None
) -> NewSession:
    settings = get_settings()
    now = utcnow()
    if remember_me:
        lifetime = timedelta(days=settings.session_remember_me_days)
        idle = lifetime
    else:
        lifetime = timedelta(hours=settings.session_lifetime_hours)
        idle = timedelta(minutes=settings.session_idle_timeout_minutes)

    token = generate_token()
    session = UserSession(
        user_id=user.id,
        token_hash=hash_token(token),
        created_at=now,
        last_seen_at=now,
        expires_at=now + lifetime,
        idle_timeout_seconds=int(idle.total_seconds()),
        user_agent=(user_agent or "")[:255] or None,
        ip_address=ip_address,
    )
    db.add(session)
    db.commit()
    return NewSession(token=token, session=session, persistent=remember_me)


def get_valid_session(db: Session, token: str) -> UserSession | None:
    """Look up a session by raw token; returns None if unknown, revoked, expired or idle."""
    session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    if session is None or session.revoked_at is not None:
        return None
    now = utcnow()
    idle_deadline = session.last_seen_at + timedelta(seconds=session.idle_timeout_seconds)
    if now >= session.expires_at or now >= idle_deadline or not session.user.is_active:
        return None
    if now - session.last_seen_at >= LAST_SEEN_RESOLUTION:
        session.last_seen_at = now
        db.commit()
    return session


def revoke_session(db: Session, session: UserSession) -> None:
    session.revoked_at = utcnow()
    db.commit()


def revoke_all_sessions(db: Session, *, user_id, except_session_id=None, commit: bool = True) -> None:
    stmt = update(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    if except_session_id is not None:
        stmt = stmt.where(UserSession.id != except_session_id)
    db.execute(stmt.values(revoked_at=utcnow()))
    if commit:
        db.commit()


# --- Password reset ------------------------------------------------------------------


def create_password_reset(db: Session, *, email: str, requested_ip: str | None) -> OutgoingEmail | None:
    """Create a reset token if an active account has this email.

    Returns the email to send (or None). Callers must respond identically either way,
    so the endpoint never reveals whether an email is registered.
    """
    settings = get_settings()
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active:
        return None

    now = utcnow()
    # Only the newest link should work.
    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )
    token = generate_token()
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(token),
            created_at=now,
            expires_at=now + timedelta(minutes=settings.password_reset_token_minutes),
            requested_ip=requested_ip,
        )
    )
    db.commit()

    # The token travels in the URL fragment (#...), which browsers never send to servers,
    # so it can't end up in access logs or Referer headers.
    link = f"{settings.frontend_url.rstrip('/')}/reset-password#token={token}"
    body = (
        f"Hi {user.name},\n\n"
        "Someone (hopefully you) asked to reset your LifeVault password.\n"
        f"Open this link within {settings.password_reset_token_minutes} minutes to choose a new password:\n\n"
        f"{link}\n\n"
        "If you didn't request this, you can ignore this email; your password won't change.\n"
    )
    return OutgoingEmail(to=user.email, subject="Reset your LifeVault password", body=body)


def reset_password(db: Session, *, token: str, new_password: str) -> None:
    record = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(token)))
    now = utcnow()
    if record is None or record.used_at is not None or now >= record.expires_at:
        raise AuthError("This reset link is invalid or has expired. Please request a new one.")
    user = db.get(User, record.user_id)
    if user is None or not user.is_active:
        raise AuthError("This reset link is invalid or has expired. Please request a new one.")
    _check_password_policy(user, new_password)

    user.password_hash = hash_password(new_password)
    user.password_changed_at = now
    record.used_at = now
    # A reset means the old password may be compromised: sign out everywhere.
    revoke_all_sessions(db, user_id=user.id, commit=False)
    db.commit()
