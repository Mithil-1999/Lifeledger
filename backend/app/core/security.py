"""Password hashing, opaque token handling and the password strength policy.

Nothing in this module logs or returns plaintext passwords or raw tokens.
"""

import hashlib
import hmac
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

# Argon2id with argon2-cffi's defaults (RFC 9106 "low memory" profile: t=3, m=64 MiB, p=4).
_hasher = PasswordHasher()

# Verified against when the account doesn't exist, so response timing doesn't reveal
# whether an email/username is registered.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(32))

PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 128  # Bounds hashing cost per request.


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def verify_dummy_password(password: str) -> None:
    """Spend the same effort as a real verification; always 'fails'."""
    verify_password(_DUMMY_HASH, password)


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def generate_token() -> str:
    """256-bit URL-safe random token for sessions, CSRF and password resets."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Keyed hash of an opaque token for storage/lookup. A database leak alone can't forge sessions."""
    key = get_settings().app_secret_key.encode()
    return hmac.new(key, token.encode(), hashlib.sha256).hexdigest()


def tokens_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


# --- Password policy ---------------------------------------------------------------

_COMMON_PASSWORDS = frozenset(
    {
        "password", "password1", "password123", "passw0rd", "123456789012", "qwertyuiop", "qwerty123456",
        "iloveyou1234", "letmein12345", "welcome12345", "admin1234567", "abc123456789", "lifevault123",
        "changeme1234", "football1234", "monkey123456", "sunshine1234", "princess1234", "dragon123456",
    }
)


def password_policy_errors(password: str, *, username: str = "", email: str = "", name: str = "") -> list[str]:
    """Return human-readable reasons the password is too weak (empty list = acceptable)."""
    errors: list[str] = []
    if len(password) < PASSWORD_MIN_LENGTH:
        errors.append(f"Password must be at least {PASSWORD_MIN_LENGTH} characters long.")
    if len(password) > PASSWORD_MAX_LENGTH:
        errors.append(f"Password must be at most {PASSWORD_MAX_LENGTH} characters long.")

    classes = sum(
        bool(re.search(pattern, password)) for pattern in (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9]")
    )
    if classes < 3:
        errors.append("Password must contain at least three of: lowercase, uppercase, number, symbol.")

    lowered = password.lower()
    if lowered in _COMMON_PASSWORDS or len(set(password)) <= 3:
        errors.append("Password is too common or predictable.")

    personal = [username.lower(), email.split("@")[0].lower()] + [p.lower() for p in name.split()]
    if any(len(part) >= 3 and part in lowered for part in personal):
        errors.append("Password must not contain your name, username or email.")
    return errors
