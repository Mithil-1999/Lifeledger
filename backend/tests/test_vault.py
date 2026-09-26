import base64
import logging
import secrets
import uuid

import pytest
from sqlalchemy import text

from app.core import vault_crypto
from app.core.config import get_settings
from app.core.vault_crypto import VaultCryptoError, decrypt_field, encrypt_field, new_wrapped_data_key, unwrap_data_key
from app.db.session import engine
from tests.conftest import make_client, requires_db
from tests.test_auth import PASSWORD, register

SECRET = "S3cr3t-Pa$$word-🔐-नेपाल"


# --- Encryption / decryption ---------------------------------------------------------------------------------------


def test_field_round_trip_and_randomised_nonces():
    user, entry, dek = uuid.uuid4(), uuid.uuid4(), secrets.token_bytes(32)
    a = encrypt_field(dek, user, entry, "password", SECRET)
    b = encrypt_field(dek, user, entry, "password", SECRET)
    assert a != b  # fresh nonce each time: identical passwords don't produce identical ciphertexts
    assert SECRET.encode() not in a
    assert a[0] == 1 and len(a) == 1 + 12 + len(SECRET.encode()) + 16
    assert decrypt_field(dek, user, entry, "password", a) == SECRET


@pytest.mark.parametrize("mutation", ["wrong_key", "other_user", "other_entry", "other_field", "flipped_bit", "truncated", "bad_version"])
def test_tampering_and_misplacement_are_detected(mutation):
    user, entry, dek = uuid.uuid4(), uuid.uuid4(), secrets.token_bytes(32)
    blob = encrypt_field(dek, user, entry, "password", SECRET)
    args = [dek, user, entry, "password", blob]
    if mutation == "wrong_key":
        args[0] = secrets.token_bytes(32)
    elif mutation == "other_user":
        args[1] = uuid.uuid4()
    elif mutation == "other_entry":
        args[2] = uuid.uuid4()  # ciphertext copied into another row
    elif mutation == "other_field":
        args[3] = "notes"  # password ciphertext pasted into the notes column
    elif mutation == "flipped_bit":
        args[4] = blob[:20] + bytes([blob[20] ^ 1]) + blob[21:]
    elif mutation == "truncated":
        args[4] = blob[:-1]
    elif mutation == "bad_version":
        args[4] = b"\x02" + blob[1:]
    with pytest.raises(VaultCryptoError):
        decrypt_field(*args)


def test_data_key_is_wrapped_by_master_key(monkeypatch):
    user = uuid.uuid4()
    wrapped, version = new_wrapped_data_key(user)
    dek = unwrap_data_key(user, wrapped, version)
    assert len(dek) == 32 and dek not in wrapped
    with pytest.raises(VaultCryptoError):
        unwrap_data_key(uuid.uuid4(), wrapped, version)  # bound to its user
    other_master = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
    from pydantic import SecretStr

    monkeypatch.setattr(get_settings(), "vault_master_key", SecretStr(other_master))
    with pytest.raises(VaultCryptoError):
        unwrap_data_key(user, wrapped, version)  # a different master key can't unwrap it


def test_missing_master_key_disables_vault(monkeypatch):
    monkeypatch.setattr(get_settings(), "vault_master_key", None)
    with pytest.raises(vault_crypto.VaultNotConfiguredError):
        new_wrapped_data_key(uuid.uuid4())


@pytest.mark.parametrize("value", ["short", base64.urlsafe_b64encode(b"x" * 16).decode(), "!!not-base64!!"])
def test_master_key_validation(value):
    from app.core.config import Settings

    with pytest.raises(ValueError, match="VAULT_MASTER_KEY"):
        Settings(vault_master_key=value)


def test_production_requires_master_key():
    from app.core.config import Settings

    with pytest.raises(ValueError, match="VAULT_MASTER_KEY must be set"):
        Settings(environment="production", app_secret_key="x" * 40, cookie_secure=True, email_backend="disabled", vault_master_key=None)


# --- API ----------------------------------------------------------------------------------------------------------------


@pytest.fixture
def user(client):
    register(client)
    return client


def unlock(client, password=PASSWORD):
    return client.post("/api/vault/unlock", json={"password": password})


def create(client, website="Gmail", password=SECRET, **extra):
    return client.post(
        "/api/vault/entries",
        json={"website": website, "url": "https://mail.google.com", "username": "mithil", "email": "mithil@gmail.com", "password": password, "category": "email", **extra},
    )


@requires_db
def test_vault_is_locked_until_password_re_entered(user):
    status = user.get("/api/vault/status").json()
    assert status == {"configured": True, "unlocked": False, "unlocked_until": None, "unlock_minutes": 10}
    assert user.get("/api/vault/entries").status_code == 423
    assert create(user).status_code == 423

    assert unlock(user, "Wrong-Password-99").status_code == 401
    assert unlock(user).status_code == 200
    assert user.get("/api/vault/status").json()["unlocked"] is True
    assert user.get("/api/vault/entries").status_code == 200

    assert user.post("/api/vault/lock").status_code == 204
    assert user.get("/api/vault/entries").status_code == 423


@requires_db
def test_unlock_is_per_session_and_expires(user):
    unlock(user)
    other_device = make_client()
    other_device.post("/api/auth/login", json={"identifier": "mithil", "password": PASSWORD})
    assert other_device.get("/api/vault/entries").status_code == 423  # another session starts locked
    with engine.begin() as conn:
        conn.execute(text("UPDATE user_sessions SET vault_unlocked_until = now() - interval '1 second' WHERE vault_unlocked_until IS NOT NULL"))
    assert user.get("/api/vault/entries").status_code == 423  # auto-locks after the timeout


@requires_db
def test_unlock_attempts_are_rate_limited(user):
    codes = [unlock(user, "Wrong-Password-99").status_code for _ in range(6)]
    assert codes[:5] == [401] * 5 and codes[5] == 429


@requires_db
def test_crud_and_secret_masking(user):
    unlock(user)
    created = create(user, notes="Recovery: first school?")
    assert created.status_code == 201
    entry = created.json()
    assert "password" not in entry and SECRET not in created.text  # never echoed back
    assert entry["username"] == "mithil" and entry["notes"] == "Recovery: first school?" and entry["has_notes"] is True

    listing = user.get("/api/vault/entries")
    assert SECRET not in listing.text and "password" not in listing.json()["items"][0]
    assert "notes" not in listing.json()["items"][0]  # notes only in the detail view
    detail = user.get(f"/api/vault/entries/{entry['id']}")
    assert SECRET not in detail.text and detail.headers["cache-control"] == "no-store"

    # Update without a password keeps the old one.
    updated = user.put(
        f"/api/vault/entries/{entry['id']}",
        json={"website": "Google", "category": "email", "username": "mithil.p", "password": None},
    ).json()
    assert updated["website"] == "Google" and updated["email"] is None and updated["notes"] is None
    assert user.post(f"/api/vault/entries/{entry['id']}/reveal", json={}).json() == {"password": SECRET}

    # Update with a new password replaces it.
    user.put(f"/api/vault/entries/{entry['id']}", json={"website": "Google", "password": "N3w-Pass!"})
    reveal = user.post(f"/api/vault/entries/{entry['id']}/reveal", json={"purpose": "copy"})
    assert reveal.json() == {"password": "N3w-Pass!"}
    assert reveal.headers["cache-control"] == "no-store"

    fav = user.patch(f"/api/vault/entries/{entry['id']}/favorite", json={"is_favorite": True}).json()
    assert fav["is_favorite"] is True

    assert user.delete(f"/api/vault/entries/{entry['id']}").status_code == 204
    assert user.get(f"/api/vault/entries/{entry['id']}").status_code == 404


@requires_db
def test_nothing_sensitive_is_stored_in_plaintext(user):
    unlock(user)
    entry = create(user, notes="PIN 4321").json()
    with engine.begin() as conn:
        row = conn.execute(
            text("SELECT website, username_enc, email_enc, password_enc, notes_enc FROM vault_entries WHERE id = :id"), {"id": entry["id"]}
        ).one()
        key_row = conn.execute(text("SELECT wrapped_key FROM vault_keys")).one()
        dump = " ".join(str(v) for v in conn.execute(text("SELECT * FROM vault_entries")).one())
    assert row.website == "Gmail"  # site name is intentionally plaintext
    for blob, plain in [(row.username_enc, "mithil"), (row.email_enc, "mithil@gmail.com"), (row.password_enc, SECRET), (row.notes_enc, "PIN 4321")]:
        assert plain.encode() not in bytes(blob)
    assert SECRET not in dump and "PIN 4321" not in dump
    master = base64.urlsafe_b64decode(get_settings().vault_master_key.get_secret_value())
    assert master not in bytes(key_row.wrapped_key)  # the master key is never in the database
    assert len(bytes(key_row.wrapped_key)) == 1 + 12 + 32 + 16  # a wrapped 256-bit data key


@requires_db
def test_create_validation(user):
    unlock(user)
    assert create(user, password=None).status_code == 422  # password required on create
    assert create(user, website="").status_code == 422
    assert create(user, category="crypto").status_code == 422
    bad_url = create(user, url="javascript:alert(document.cookie)")
    assert bad_url.status_code == 422 and "http(s)" in bad_url.text
    for evil in ["data:text/html,<script>alert(1)</script>", "vbscript:msgbox", "file:///etc/passwd", "JavaScript:void(0)"]:
        assert create(user, url=evil).status_code == 422
    assert create(user, url="example.com").json()["url"] == "https://example.com"  # scheme added
    assert create(user, url="example.com:8443/login").json()["url"] == "https://example.com:8443/login"
    assert create(user, password="x" * 1025).status_code == 422
    assert SECRET not in create(user, category="crypto").text  # validation errors never echo input


@requires_db
def test_search_filters_and_favorites(user):
    unlock(user)
    create(user, "Gmail", category="email", username="mithil.p")
    create(user, "NIC Asia", url="https://nicasia.com.np", category="banking", username="9800000000", email=None, is_favorite=True)
    create(user, "Nagarik App", url="https://nagarikapp.gov.np", category="government", username="citizen42", email=None)
    names = lambda **p: [e["website"] for e in user.get("/api/vault/entries", params=p).json()["items"]]  # noqa: E731
    assert names() == ["NIC Asia", "Gmail", "Nagarik App"]  # favourites first, then A-Z
    assert names(search="citizen") == ["Nagarik App"]  # matches the encrypted username after decryption
    assert names(search="gov.np") == ["Nagarik App"]
    assert names(category="banking") == ["NIC Asia"]
    assert names(favorites="true") == ["NIC Asia"]
    counts = user.get("/api/vault/entries").json()["counts"]
    assert counts["all"] == 3 and counts["favorites"] == 1 and counts["banking"] == 1 and counts["shopping"] == 0


@requires_db
def test_audit_log_records_actions_without_secrets(user):
    unlock(user, "Wrong-Password-99")
    unlock(user)
    entry = create(user).json()
    user.put(f"/api/vault/entries/{entry['id']}", json={"website": "Gmail", "password": "Changed-1!"})
    user.post(f"/api/vault/entries/{entry['id']}/reveal", json={"purpose": "reveal"})
    user.post(f"/api/vault/entries/{entry['id']}/reveal", json={"purpose": "copy"})
    user.delete(f"/api/vault/entries/{entry['id']}")

    log = user.get("/api/vault/audit").json()
    assert [e["action"] for e in reversed(log)] == [
        "unlock_failed",
        "vault_unlocked",
        "entry_created",
        "entry_updated",
        "secret_revealed",
        "secret_copied",
        "entry_deleted",
    ]
    assert all(e["entry_label"] == "Gmail" for e in log if e["entry_id"])
    with engine.begin() as conn:
        everything = " ".join(str(r) for r in conn.execute(text("SELECT * FROM vault_audit_log")).all())
    assert SECRET not in everything and "Changed-1!" not in everything


@requires_db
def test_secrets_never_reach_the_logs(user, caplog):
    caplog.set_level(logging.DEBUG)
    unlock(user)
    entry = create(user, notes="Recovery phrase: apple banana").json()
    user.post(f"/api/vault/entries/{entry['id']}/reveal", json={})
    create(user, category="crypto")  # a validation failure
    logged = caplog.text + " ".join(repr(r.args) for r in caplog.records)
    assert SECRET not in logged and "apple banana" not in logged and PASSWORD not in logged


@requires_db
def test_other_users_cannot_access_entries(user):
    unlock(user)
    entry = create(user).json()
    other = make_client()
    register(other, username="other", email="other@example.com")
    other.post("/api/vault/unlock", json={"password": PASSWORD})
    assert other.get("/api/vault/entries").json()["items"] == []
    for method, url, body in [
        ("get", f"/api/vault/entries/{entry['id']}", None),
        ("post", f"/api/vault/entries/{entry['id']}/reveal", {}),
        ("put", f"/api/vault/entries/{entry['id']}", {"website": "x"}),
        ("patch", f"/api/vault/entries/{entry['id']}/favorite", {"is_favorite": True}),
        ("delete", f"/api/vault/entries/{entry['id']}", None),
    ]:
        response = getattr(other, method)(url, json=body) if body is not None else getattr(other, method)(url)
        assert response.status_code == 404
    assert user.post(f"/api/vault/entries/{entry['id']}/reveal", json={}).json() == {"password": SECRET}  # untouched
    assert all(e["action"] != "secret_revealed" for e in other.get("/api/vault/audit").json())


@requires_db
def test_unauthenticated_access_is_refused(client):
    for method, url in [("get", "/api/vault/status"), ("get", "/api/vault/entries"), ("post", "/api/vault/unlock"), ("get", "/api/vault/audit")]:
        response = getattr(client, method)(url, json={"password": "x"}) if method == "post" else getattr(client, method)(url)
        assert response.status_code == 401


@requires_db
def test_vault_unavailable_without_master_key(user, monkeypatch):
    monkeypatch.setattr(get_settings(), "vault_master_key", None)
    assert user.get("/api/vault/status").json()["configured"] is False
    assert unlock(user).status_code == 503
    assert user.get("/api/vault/entries").status_code == 503
    assert user.get("/api/auth/me").status_code == 200  # the rest of the app keeps working
