from fastapi.testclient import TestClient

from app.api.routes import health as health_module
from app.main import app

client = TestClient(app)


def test_health_ok_when_database_reachable(monkeypatch):
    monkeypatch.setattr(health_module, "check_database_connection", lambda: True)
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["service"] == "LifeVault API"


def test_health_degraded_when_database_unreachable(monkeypatch):
    monkeypatch.setattr(health_module, "check_database_connection", lambda: False)
    response = client.get("/api/health")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["database"] == "unavailable"


def test_security_headers_present(monkeypatch):
    monkeypatch.setattr(health_module, "check_database_connection", lambda: True)
    response = client.get("/api/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert "default-src 'none'" in response.headers["Content-Security-Policy"]


def test_cors_allows_frontend_origin():
    from app.core.config import get_settings

    origin = get_settings().frontend_url
    response = client.options(
        "/api/health",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_cors_rejects_unknown_origin():
    response = client.options(
        "/api/health",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in response.headers
