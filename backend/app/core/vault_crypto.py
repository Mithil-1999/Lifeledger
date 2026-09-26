"""Cryptography for the password vault. Envelope encryption with AES-256-GCM.

Key hierarchy
-------------
1. Master key (KEK): 32 random bytes from VAULT_MASTER_KEY. It exists only in the process
   environment, never in the database, logs or API responses.
2. Per-user data key (DEK): 32 random bytes, generated on the user's first vault use. It is
   stored in the database only *wrapped* (AES-256-GCM encrypted) with the KEK.
3. Every secret field (username, email, password, notes) is encrypted with the user's DEK.

Ciphertext format:  version (1 byte) || nonce (12 random bytes) || ciphertext || GCM tag (16)

Associated data (authenticated, not stored) binds each ciphertext to where it belongs:
    DEK:    b"lifevault:dek:v1:<user_id>:k<kek_version>"
    field:  b"lifevault:field:v1:<user_id>:<entry_id>:<field_name>"
So a ciphertext copied to another user, entry or field fails authentication instead of
decrypting. GCM also detects any bit flip or truncation.

A database leak alone reveals no secrets (it has no KEK). Stealing both the database and
the environment/key does, which is why the key must live outside the database backups.
"""

import base64
import os
import uuid

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings

FORMAT_VERSION = 1
NONCE_BYTES = 12
KEY_BYTES = 32


class VaultNotConfiguredError(RuntimeError):
    """VAULT_MASTER_KEY is missing: the vault is unavailable (the rest of the app works)."""


class VaultCryptoError(ValueError):
    """Decryption failed: wrong key, tampered data, or a ciphertext in the wrong place.
    Deliberately carries no details about the data."""


def _master_key() -> tuple[bytes, int]:
    settings = get_settings()
    if settings.vault_master_key is None:
        raise VaultNotConfiguredError("The password vault isn't configured (VAULT_MASTER_KEY is not set).")
    return base64.urlsafe_b64decode(settings.vault_master_key.get_secret_value().encode()), settings.vault_master_key_version


def _seal(key: bytes, plaintext: bytes, aad: bytes) -> bytes:
    nonce = os.urandom(NONCE_BYTES)  # never reused: fresh random 96-bit nonce per encryption
    return bytes([FORMAT_VERSION]) + nonce + AESGCM(key).encrypt(nonce, plaintext, aad)


def _open(key: bytes, blob: bytes, aad: bytes) -> bytes:
    if len(blob) < 1 + NONCE_BYTES + 16 or blob[0] != FORMAT_VERSION:
        raise VaultCryptoError("Unsupported or corrupt ciphertext.")
    nonce, body = blob[1 : 1 + NONCE_BYTES], blob[1 + NONCE_BYTES :]
    try:
        return AESGCM(key).decrypt(nonce, body, aad)
    except InvalidTag:
        raise VaultCryptoError("Decryption failed.") from None


def _dek_aad(user_id: uuid.UUID, kek_version: int) -> bytes:
    return f"lifevault:dek:v1:{user_id}:k{kek_version}".encode()


def _field_aad(user_id: uuid.UUID, entry_id: uuid.UUID, field: str) -> bytes:
    return f"lifevault:field:v1:{user_id}:{entry_id}:{field}".encode()


# --- Data keys --------------------------------------------------------------------------------------------


def new_wrapped_data_key(user_id: uuid.UUID) -> tuple[bytes, int]:
    """Create a random DEK for a user and return it wrapped with the master key."""
    kek, version = _master_key()
    return _seal(kek, AESGCM.generate_key(bit_length=256), _dek_aad(user_id, version)), version


def unwrap_data_key(user_id: uuid.UUID, wrapped: bytes, kek_version: int) -> bytes:
    kek, current_version = _master_key()
    if kek_version != current_version:
        raise VaultCryptoError("This vault key was wrapped with a different master key version.")
    dek = _open(kek, wrapped, _dek_aad(user_id, kek_version))
    if len(dek) != KEY_BYTES:
        raise VaultCryptoError("Corrupt data key.")
    return dek


# --- Fields ----------------------------------------------------------------------------------------------------


def encrypt_field(dek: bytes, user_id: uuid.UUID, entry_id: uuid.UUID, field: str, value: str) -> bytes:
    return _seal(dek, value.encode("utf-8"), _field_aad(user_id, entry_id, field))


def decrypt_field(dek: bytes, user_id: uuid.UUID, entry_id: uuid.UUID, field: str, blob: bytes) -> str:
    return _open(dek, blob, _field_aad(user_id, entry_id, field)).decode("utf-8")
