"""Single-container mode: the API also serves the built web app (STATIC_DIR)."""

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.security_headers import WEB_CSP


@pytest.fixture
def site(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>LifeVault</title>", encoding="utf-8")
    (tmp_path / "assets" / "index-abc.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "sw.js").write_text("// sw", encoding="utf-8")
    (tmp_path / "manifest.webmanifest").write_text("{}", encoding="utf-8")
    (tmp_path.parent / "secret.txt").write_text("outside", encoding="utf-8")
    monkeypatch.setattr(get_settings(), "static_dir", tmp_path)
    from app.main import create_app

    return TestClient(create_app())


def test_serves_the_app_and_falls_back_to_index_for_client_routes(site):
    home = site.get("/")
    assert home.status_code == 200 and "<title>LifeVault</title>" in home.text
    assert home.headers["cache-control"] == "no-cache"
    assert home.headers["content-security-policy"] == WEB_CSP
    deep = site.get("/reports?report=bills")
    assert deep.status_code == 200 and "LifeVault" in deep.text  # React Router handles it


def test_assets_are_cached_and_special_files_are_not(site):
    asset = site.get("/assets/index-abc.js")
    assert asset.status_code == 200 and asset.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert site.get("/sw.js").headers["cache-control"] == "no-cache"
    manifest = site.get("/manifest.webmanifest")
    assert manifest.headers["content-type"].startswith("application/manifest+json")


def test_api_routes_still_win_and_unknown_api_paths_are_404(site):
    assert site.get("/api/health").json()["service"] == "LifeVault API"
    missing = site.get("/api/does-not-exist")
    assert missing.status_code == 404 and "<html" not in missing.text.lower()
    # API responses keep the strict API policy.
    assert site.get("/api/health").headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"


def test_cannot_read_files_outside_the_build_folder(site):
    for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"):
        response = site.get(path)
        assert "outside" not in response.text


def test_not_mounted_without_static_dir():
    from app.main import create_app

    assert get_settings().static_dir is None
    client = TestClient(create_app())
    assert client.get("/dashboard").status_code == 404
