import re

import pytest
from sqlalchemy import select, text

from app.core.security import verify_password
from app.db.session import SessionLocal, engine
from app.models import PasswordResetToken, User, UserSession
from app.services.email import sent_messages
from tests.conftest import make_client, requires_db

pytestmark = requires_db

PASSWORD = "Correct-Horse-42"
NEW_PASSWORD = "Battery-Staple-77"


def register(client, **overrides):
    payload = {
        "name": "Mithil Pandit",
        "username": "mithil",
        "email": "mithil@example.com",
        "password": PASSWORD,
        "confirm_password": PASSWORD,
        **overrides,
    }
    return client.post("/api/auth/register", json=payload)


def login(client, identifier="mithil", password=PASSWORD, **extra):
    return client.post("/api/auth/login", json={"identifier": identifier, "password": password, **extra})


def reset_token_from_email() -> str:
    assert sent_messages, "no email was sent"
    match = re.search(r"/reset-password#token=([A-Za-z0-9_-]+)", sent_messages[-1].body)
    assert match
    return match.group(1)


# --- Registration -------------------------------------------------------------------


def test_register_creates_user_and_signs_in(client):
    response = register(client)
    assert response.status_code == 201
    body = response.json()
    assert body["username"] == "mithil" and body["email"] == "mithil@example.com"
    assert "password" not in str(body).lower()
    assert client.get("/api/auth/me").status_code == 200


def test_register_stores_only_argon2_hash(client):
    register(client)
    with SessionLocal() as db:
        user = db.scalar(select(User))
        assert user.password_hash.startswith("$argon2id$")
        assert PASSWORD not in user.password_hash
        assert verify_password(user.password_hash, PASSWORD)


def test_register_normalizes_case(client):
    response = register(client, username="MithIL", email="MITHIL@Example.COM")
    assert response.status_code == 201
    assert response.json()["username"] == "mithil"
    assert response.json()["email"] == "mithil@example.com"


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"email": "Mithil@Example.com", "username": "other"}, "email"),
        ({"email": "other@example.com", "username": "MITHIL"}, "username"),
    ],
)
def test_duplicate_registration_rejected(client, overrides, field):
    assert register(client).status_code == 201
    response = register(make_client(), **overrides)
    assert response.status_code == 409
    assert response.json()["detail"]["field"] == field


@pytest.mark.parametrize(
    ("overrides", "fragment"),
    [
        ({"email": "not-an-email"}, "email"),
        ({"password": "short1A!", "confirm_password": "short1A!"}, "at least 12"),
        ({"password": "alllowercaseletters", "confirm_password": "alllowercaseletters"}, "three of"),
        ({"password": "Mithil-Secret-99", "confirm_password": "Mithil-Secret-99"}, "must not contain"),
        ({"confirm_password": "Different-Pass-11"}, "do not match"),
        ({"username": "ab"}, "at least 3"),
        ({"username": "bad name!"}, "pattern"),
    ],
)
def test_register_validation(client, overrides, fragment):
    response = register(client, **overrides)
    assert response.status_code == 422
    messages = " ".join(e["msg"] for e in response.json()["errors"])
    assert fragment in messages
    # Submitted values (e.g. passwords) are never echoed back.
    assert "input" not in str(response.json())
    assert PASSWORD not in response.text


def test_registration_can_be_disabled(client, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "registration_enabled", False)
    assert register(client).status_code == 403
    assert client.get("/api/auth/config").json()["registration_enabled"] is False


# --- Login / logout -----------------------------------------------------------------


@pytest.mark.parametrize("identifier", ["mithil", "MITHIL", "mithil@example.com", "Mithil@Example.com"])
def test_login_with_username_or_email(identifier):
    register(make_client())
    client = make_client()
    response = login(client, identifier=identifier)
    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert "lv_session=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert client.get("/api/auth/me").json()["username"] == "mithil"


def test_session_token_is_stored_hashed():
    register(make_client())
    client = make_client()
    login(client)
    raw = client.cookies.get("lv_session")
    with SessionLocal() as db:
        hashes = db.scalars(select(UserSession.token_hash)).all()
    assert raw not in hashes and all(len(h) == 64 for h in hashes)


def test_wrong_password_and_unknown_user_get_same_generic_error():
    register(make_client())
    wrong = login(make_client(), password="Wrong-Password-1")
    unknown = login(make_client(), identifier="nobody")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Invalid email/username or password."}


def test_disabled_account_cannot_log_in():
    register(make_client())
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET status = 'disabled'"))
    assert login(make_client()).status_code == 401


def test_disabling_account_ends_existing_sessions(client):
    register(client)
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET status = 'disabled'"))
    assert client.get("/api/auth/me").status_code == 401


def test_logout_revokes_session_server_side(client):
    register(client)
    stolen_cookie = client.cookies.get("lv_session")
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    # Replaying the old cookie doesn't work either: the session is revoked in the database.
    attacker = make_client()
    attacker.cookies.set("lv_session", stolen_cookie)
    assert attacker.get("/api/auth/me").status_code == 401


def test_login_rate_limited():
    register(make_client())
    client = make_client()
    codes = [login(client, password="Wrong-Password-1").status_code for _ in range(6)]
    assert codes[:5] == [401] * 5
    assert codes[5] == 429
    # Even the right password is refused while limited.
    limited = login(client)
    assert limited.status_code == 429 and "Retry-After" in limited.headers


# --- Protected routes / CSRF ------------------------------------------------------


def test_protected_route_requires_authentication(client):
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.set("lv_session", "forged-token-value")
    assert client.get("/api/auth/me").status_code == 401


def test_protected_router_dependency_applies(client):
    from fastapi import APIRouter

    from app.api.router import protected_router

    probe = APIRouter()

    @probe.get("/__probe")
    def _probe():
        return {"ok": True}

    protected_router.include_router(probe)
    assert client.get("/api/__probe").status_code == 401
    register(client)
    assert client.get("/api/__probe").json() == {"ok": True}


def test_state_changing_requests_require_csrf_token():
    register(make_client())
    client = make_client()
    del client.headers["X-CSRF-Token"]
    assert login(client).status_code == 403
    client.headers["X-CSRF-Token"] = "wrong"
    assert login(client).status_code == 403


# --- Change password ----------------------------------------------------------------


def test_change_password_flow(client):
    register(client)
    other_device = make_client()
    login(other_device)
    old_cookie = client.cookies.get("lv_session")

    response = client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD, "confirm_new_password": NEW_PASSWORD},
    )
    assert response.status_code == 200
    assert client.get("/api/auth/me").status_code == 200  # this device stays signed in (rotated token)
    assert client.cookies.get("lv_session") != old_cookie
    assert other_device.get("/api/auth/me").status_code == 401  # other devices are signed out
    assert login(make_client(), password=PASSWORD).status_code == 401
    assert login(make_client(), password=NEW_PASSWORD).status_code == 200


def test_change_password_rejects_wrong_current_and_weak_new(client):
    register(client)
    wrong = client.post(
        "/api/auth/change-password",
        json={"current_password": "Nope-Nope-123", "new_password": NEW_PASSWORD, "confirm_new_password": NEW_PASSWORD},
    )
    assert wrong.status_code == 400 and "incorrect" in wrong.json()["detail"]
    weak = client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "weakpassword", "confirm_new_password": "weakpassword"},
    )
    assert weak.status_code == 400
    mismatch = client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD, "confirm_new_password": "Other-Pass-123"},
    )
    assert mismatch.status_code == 422


def test_change_password_requires_login(client):
    response = client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD, "confirm_new_password": NEW_PASSWORD},
    )
    assert response.status_code == 401


# --- Password reset -----------------------------------------------------------------


def test_password_reset_flow(client):
    register(client)
    response = make_client().post("/api/auth/forgot-password", json={"email": "MITHIL@example.com"})
    assert response.status_code == 202
    token = reset_token_from_email()
    assert token not in response.text  # never exposed by the API

    with SessionLocal() as db:
        assert token not in db.scalars(select(PasswordResetToken.token_hash)).all()

    reset = make_client().post(
        "/api/auth/reset-password",
        json={"token": token, "new_password": NEW_PASSWORD, "confirm_new_password": NEW_PASSWORD},
    )
    assert reset.status_code == 204
    assert client.get("/api/auth/me").status_code == 401  # all sessions revoked
    assert login(make_client(), password=NEW_PASSWORD).status_code == 200

    reuse = make_client().post(
        "/api/auth/reset-password",
        json={"token": token, "new_password": "Another-Pass-88", "confirm_new_password": "Another-Pass-88"},
    )
    assert reuse.status_code == 400  # single use


def test_forgot_password_does_not_reveal_accounts():
    register(make_client())
    known = make_client().post("/api/auth/forgot-password", json={"email": "mithil@example.com"})
    unknown = make_client().post("/api/auth/forgot-password", json={"email": "ghost@example.com"})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert len(sent_messages) == 1


def test_new_reset_request_invalidates_previous_link():
    register(make_client())
    make_client().post("/api/auth/forgot-password", json={"email": "mithil@example.com"})
    first = reset_token_from_email()
    make_client().post("/api/auth/forgot-password", json={"email": "mithil@example.com"})
    response = make_client().post(
        "/api/auth/reset-password",
        json={"token": first, "new_password": NEW_PASSWORD, "confirm_new_password": NEW_PASSWORD},
    )
    assert response.status_code == 400


def test_invalid_and_weak_reset_rejected():
    register(make_client())
    bogus = make_client().post(
        "/api/auth/reset-password",
        json={"token": "x" * 43, "new_password": NEW_PASSWORD, "confirm_new_password": NEW_PASSWORD},
    )
    assert bogus.status_code == 400
    make_client().post("/api/auth/forgot-password", json={"email": "mithil@example.com"})
    weak = make_client().post(
        "/api/auth/reset-password",
        json={"token": reset_token_from_email(), "new_password": "weakpassword", "confirm_new_password": "weakpassword"},
    )
    assert weak.status_code == 400


# --- Expiration ---------------------------------------------------------------------


def test_expired_reset_token_rejected():
    register(make_client())
    make_client().post("/api/auth/forgot-password", json={"email": "mithil@example.com"})
    token = reset_token_from_email()
    with engine.begin() as conn:
        conn.execute(text("UPDATE password_reset_tokens SET expires_at = now() - interval '1 second'"))
    response = make_client().post(
        "/api/auth/reset-password",
        json={"token": token, "new_password": NEW_PASSWORD, "confirm_new_password": NEW_PASSWORD},
    )
    assert response.status_code == 400


def test_session_expires_after_absolute_lifetime(client):
    register(client)
    with engine.begin() as conn:
        conn.execute(text("UPDATE user_sessions SET expires_at = now() - interval '1 second'"))
    assert client.get("/api/auth/me").status_code == 401


def test_session_expires_after_idle_timeout(client):
    register(client)
    with engine.begin() as conn:
        conn.execute(text("UPDATE user_sessions SET last_seen_at = now() - interval '9 hours'"))
    assert client.get("/api/auth/me").status_code == 401


def test_activity_extends_idle_window(client):
    register(client)
    with engine.begin() as conn:
        conn.execute(text("UPDATE user_sessions SET last_seen_at = now() - interval '7 hours'"))
    assert client.get("/api/auth/me").status_code == 200
    with engine.begin() as conn:
        last_seen_age = conn.execute(text("SELECT now() - last_seen_at FROM user_sessions")).scalar_one()
    assert last_seen_age.total_seconds() < 60


def test_remember_me_sets_persistent_cookie_and_long_session():
    register(make_client())
    remembered = login(make_client(), remember_me=True)
    browser_session = login(make_client(), remember_me=False)
    assert "Max-Age=" in remembered.headers["set-cookie"]
    assert "Max-Age=" not in browser_session.headers["set-cookie"]
    with engine.begin() as conn:
        lifetimes = conn.execute(
            text("SELECT extract(epoch FROM expires_at - created_at) FROM user_sessions ORDER BY created_at")
        ).scalars().all()
    assert lifetimes[-2] > 29 * 86400  # remember me: ~30 days
    assert lifetimes[-1] <= 12 * 3600  # regular: 12 hours
