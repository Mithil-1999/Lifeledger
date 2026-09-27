import json
import logging
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.db.session import SessionLocal
from app.models import Expense, Income, User
from tests.conftest import make_client, requires_db
from tests.test_auth import PASSWORD, login, register
from tests.test_finance import add_expense, add_income
from tests.test_records import PDF, upload

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def user(client):
    register(client)
    return client


def profile(**changes):
    return {"name": "Mithil Pandit", "username": "mithil", "email": "mithil@example.com", **changes}


def events(client) -> list[str]:
    return [e["event"] for e in client.get("/api/account/security-activity").json()]


# --- Profile -----------------------------------------------------------------------------------------------------


@requires_db
def test_update_name_without_password(user):
    response = user.put("/api/account/profile", json=profile(name="Mithil P."))
    assert response.status_code == 200 and response.json()["name"] == "Mithil P."
    assert "profile_updated" in events(user)


@requires_db
def test_changing_username_or_email_needs_the_password(user):
    assert user.put("/api/account/profile", json=profile(username="mithil2")).status_code == 403
    assert user.put("/api/account/profile", json=profile(email="new@example.com", current_password="wrong")).status_code == 403
    ok = user.put("/api/account/profile", json=profile(email="New@Example.com", username="mithil2", current_password=PASSWORD))
    assert ok.status_code == 200
    assert (ok.json()["email"], ok.json()["username"]) == ("new@example.com", "mithil2")  # normalised to lower case
    assert {"email_changed", "username_changed"} <= set(events(user))
    fresh = make_client()
    assert login(fresh, identifier="mithil2").status_code == 200


@requires_db
def test_profile_conflicts_and_validation(user):
    other = make_client()
    register(other, username="other", email="other@example.com")
    assert user.put("/api/account/profile", json=profile(username="other", current_password=PASSWORD)).status_code == 409
    assert user.put("/api/account/profile", json=profile(email="other@example.com", current_password=PASSWORD)).status_code == 409
    assert user.put("/api/account/profile", json=profile(email="not-an-email")).status_code == 422
    assert user.put("/api/account/profile", json=profile(name="")).status_code == 422
    assert user.put("/api/account/profile", json={**profile(), "status": "disabled"}).status_code == 422


# --- Profile picture ------------------------------------------------------------------------------------------------


@requires_db
def test_avatar_upload_view_replace_delete(user):
    assert user.get("/api/account/avatar").status_code == 404
    response = user.post("/api/account/avatar", files={"file": ("me.png", PNG, "image/png")})
    assert response.status_code == 200 and response.json()["has_avatar"] is True
    shown = user.get("/api/account/avatar")
    assert shown.status_code == 200 and shown.content == PNG
    assert shown.headers["content-type"] == "image/png"
    assert "sandbox" in shown.headers["content-security-policy"]
    first_path = _avatar_file(user)
    user.post("/api/account/avatar", files={"file": ("me2.png", PNG + b"x", "image/png")})
    assert not first_path.exists()  # the replaced file is removed
    assert user.delete("/api/account/avatar").json()["has_avatar"] is False
    assert user.get("/api/account/avatar").status_code == 404
    assert not any(first_path.parent.iterdir())


def _avatar_file(client):
    from app.services.account import avatar_path

    with SessionLocal() as db:
        u = db.scalar(select(User).where(User.username == client.get("/api/auth/me").json()["username"]))
        return avatar_path(u)


@requires_db
def test_avatar_rejects_non_images_and_large_files(user):
    assert user.post("/api/account/avatar", files={"file": ("doc.pdf", PDF, "application/pdf")}).status_code == 415
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    assert user.post("/api/account/avatar", files={"file": ("x.svg", svg, "image/svg+xml")}).status_code == 415
    assert user.post("/api/account/avatar", files={"file": ("fake.png", b"not really a png", "image/png")}).status_code == 415
    big = PNG + b"\x00" * (3 * 1024 * 1024)
    assert user.post("/api/account/avatar", files={"file": ("big.png", big, "image/png")}).status_code == 413


# --- Sessions and security activity -----------------------------------------------------------------------------------


@requires_db
def test_sessions_list_revoke_and_revoke_others(user):
    laptop = make_client()
    phone = make_client()
    assert login(laptop).status_code == 200 and login(phone).status_code == 200
    sessions = user.get("/api/account/sessions").json()
    assert len(sessions) == 3 and sum(s["current"] for s in sessions) == 1
    current = next(s for s in sessions if s["current"])
    assert user.delete(f"/api/account/sessions/{current['id']}").status_code == 409

    laptop_id = next(s["id"] for s in laptop.get("/api/account/sessions").json() if s["current"])
    assert user.delete(f"/api/account/sessions/{laptop_id}").status_code == 204
    assert laptop.get("/api/auth/me").status_code == 401
    assert phone.get("/api/auth/me").status_code == 200

    assert user.post("/api/account/sessions/revoke-others").json() == {"count": 1}
    assert phone.get("/api/auth/me").status_code == 401
    assert user.get("/api/auth/me").status_code == 200
    assert len(user.get("/api/account/sessions").json()) == 1
    assert {"session_revoked", "other_sessions_revoked"} <= set(events(user))


@requires_db
def test_sessions_are_private(user):
    other = make_client()
    register(other, username="other", email="other@example.com")
    other_session = other.get("/api/account/sessions").json()[0]["id"]
    assert user.delete(f"/api/account/sessions/{other_session}").status_code == 404
    assert other.get("/api/auth/me").status_code == 200


@requires_db
def test_security_activity_records_auth_events_without_secrets(user):
    user.post("/api/auth/logout")
    bad = make_client()
    assert login(bad, password="Wrong-password-1").status_code == 401
    assert login(user).status_code == 200
    user.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "Brand-New-Pass-9", "confirm_new_password": "Brand-New-Pass-9"},
    )
    activity = user.get("/api/account/security-activity").json()
    assert [e["event"] for e in activity][:4] == ["password_changed", "login_succeeded", "login_failed", "logout"]
    assert activity[0]["ip_address"] and "testclient" in (activity[0]["user_agent"] or "").lower()
    assert PASSWORD not in json.dumps(activity) and "Brand-New-Pass-9" not in json.dumps(activity)
    # Unknown accounts don't create activity for anyone.
    assert login(make_client(), identifier="nobody", password="Whatever-123").status_code == 401


@requires_db
def test_two_factor_status_is_honest(user):
    assert user.get("/api/account/two-factor").json() == {"available": False, "enabled": False, "methods_planned": ["totp", "recovery_codes"]}


# --- Preferences --------------------------------------------------------------------------------------------------------


@requires_db
def test_preferences(user):
    prefs = user.get("/api/account/preferences").json()
    assert prefs == {"currency": "NPR", "date_format": "default", "timezone": "Asia/Kathmandu", "supported_currencies": ["NPR"]}
    updated = user.put("/api/account/preferences", json={"currency": "NPR", "date_format": "iso"})
    assert updated.status_code == 200 and updated.json()["date_format"] == "iso"
    assert user.put("/api/account/preferences", json={"currency": "USD", "date_format": "iso"}).status_code == 422
    assert user.put("/api/account/preferences", json={"currency": "NPR", "date_format": "weird"}).status_code == 422


# --- Export and backup information ---------------------------------------------------------------------------------------


@requires_db
def test_export_requires_password_and_contains_only_your_data(user):
    add_income(user, "50000.50", date(2025, 1, 5))
    add_expense(user, "120.25", date(2025, 1, 6), description="Lunch")
    user.post("/api/notes", json={"title": "Diary", "content": "Private thoughts"})
    user.post("/api/vault/unlock", json={"password": PASSWORD})
    user.post("/api/vault/entries", json={"website": "Bank", "password": "Vault-Secret-123", "username": "me@bank"})
    other = make_client()
    register(other, username="other", email="other@example.com")
    add_expense(other, "999.99", date(2025, 1, 6), description="Not mine")

    assert user.post("/api/account/export", json={"scope": "all", "password": "wrong"}).status_code == 403
    response = user.post("/api/account/export", json={"scope": "all", "password": PASSWORD})
    assert response.status_code == 200
    assert response.headers["content-disposition"].startswith('attachment; filename="lifevault-all-export-')
    assert response.headers["cache-control"] == "no-store"
    data = response.json()
    assert data["profile"]["username"] == "mithil" and "password_hash" not in data["profile"]
    assert [i["amount"] for i in data["incomes"]] == ["50000.50"]
    assert [e["description"] for e in data["expenses"]] == ["Lunch"]
    assert data["notes"][0]["content"] == "Private thoughts"
    assert data["vault_entries"][0] == {k: data["vault_entries"][0][k] for k in ("id", "website", "url", "category", "is_favorite", "created_at", "updated_at")}
    text = response.text
    for secret in ("Vault-Secret-123", "me@bank", "password_enc", "token_hash", "storage_key", "Not mine", PASSWORD):
        assert secret not in text

    financial = user.post("/api/account/export", json={"scope": "financial", "password": PASSWORD}).json()
    assert "incomes" in financial and "notes" not in financial and "profile" not in financial
    personal = user.post("/api/account/export", json={"scope": "personal", "password": PASSWORD}).json()
    assert "notes" in personal and "incomes" not in personal
    assert events(user).count("data_exported") == 3


@requires_db
def test_backup_info(user):
    add_income(user)
    add_expense(user)
    add_expense(user)
    upload(user)
    info = user.get("/api/account/backup-info").json()
    assert info["counts"]["incomes"] == 1 and info["counts"]["expenses"] == 2 and info["counts"]["documents"] == 1
    assert info["document_bytes"] == len(PDF)
    assert info["last_export_at"] is None
    assert info["database_revision"] == "0010"


# --- Account deletion ---------------------------------------------------------------------------------------------------------


@requires_db
def test_delete_account_requires_confirmation_and_removes_everything(user):
    user.post("/api/categories", json={"kind": "expense", "name": "Pets"})
    pets = next(c["id"] for c in user.get("/api/categories", params={"kind": "expense"}).json() if c["name"] == "Pets")
    user.post("/api/expenses", json={"amount": "10.00", "date": "2025-01-01", "category_id": pets, "payment_method": "cash"})
    user.post("/api/budgets", json={"category_id": pets, "month": "2025-01", "amount": "100.00"})
    add_income(user)
    bill = user.post("/api/bills", json={"name": "Rent", "amount": "100.00", "category": "rent", "due_date": "2025-01-01", "frequency": "monthly"}).json()
    user.post(f"/api/bills/{bill['id']}/pay", json={"paid_on": "2025-01-01", "record_expense": True})
    upload(user)
    user.post("/api/account/avatar", files={"file": ("me.png", PNG, "image/png")})
    storage = get_settings().document_storage_dir
    uid = user.get("/api/auth/me").json()["id"]
    assert (storage / uid).exists() and (storage / "avatars" / uid).exists()
    other = make_client()
    register(other, username="other", email="other@example.com")
    add_income(other)

    assert user.request("DELETE", "/api/account", json={"password": PASSWORD, "confirmation": "delete"}).status_code == 422
    assert user.request("DELETE", "/api/account", json={"password": "wrong", "confirmation": "DELETE"}).status_code == 403
    response = user.request("DELETE", "/api/account", json={"password": PASSWORD, "confirmation": "DELETE"})
    assert response.status_code == 204
    assert user.get("/api/auth/me").status_code == 401
    assert login(make_client()).status_code == 401
    assert not (storage / uid).exists() and not (storage / "avatars" / uid).exists()
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(User).where(User.username == "mithil")) == 0
        assert db.scalar(select(func.count()).select_from(Expense)) == 0
        assert db.scalar(select(func.count()).select_from(Income)) == 1  # the other user's data is untouched
    assert other.get("/api/auth/me").status_code == 200


# --- Audit fixes ------------------------------------------------------------------------------------------------------------------


def test_unhandled_errors_are_logged_without_their_message(caplog):
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/boom")
    def boom():
        content = "my private " + "diary"  # runtime data, like SQL parameters (not in the source line)
        raise RuntimeError(f"INSERT ... parameters: {{'content': {content!r}}}")

    caplog.set_level(logging.ERROR)
    response = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert response.status_code == 500 and response.json() == {"detail": "Internal server error."}
    assert "RuntimeError" in caplog.text and "boom" in caplog.text
    assert "my private diary" not in caplog.text


@requires_db
def test_hsts_only_when_cookies_are_secure(client, monkeypatch):
    assert "strict-transport-security" not in client.get("/api/health").headers
    monkeypatch.setattr(get_settings(), "cookie_secure", True)
    assert client.get("/api/health").headers["strict-transport-security"] == "max-age=31536000; includeSubDomains"


def test_forwarded_for_uses_the_address_added_by_our_proxy(monkeypatch):
    from starlette.requests import Request

    from app.core.rate_limit import client_ip

    def request(xff):
        return Request({"type": "http", "headers": [(b"x-forwarded-for", xff.encode())], "client": ("10.0.0.2", 1234)})

    assert client_ip(request("6.6.6.6, 203.0.113.9")) == "10.0.0.2"  # proxy headers not trusted by default
    monkeypatch.setattr(get_settings(), "trust_proxy_headers", True)
    # A client-supplied "6.6.6.6" can't be used to pretend to be someone else.
    assert client_ip(request("6.6.6.6, 203.0.113.9")) == "203.0.113.9"
