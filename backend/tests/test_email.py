from app.core.config import get_settings
from app.services.email import OutgoingEmail, _build_message


def test_reset_links_survive_encoding_intact():
    """Regression: quoted-printable turned '#token=' into '#token=3D' and wrapped long URLs."""
    link = "http://localhost:5173/reset-password#token=" + "Ab_-" * 11
    raw = bytes(_build_message(get_settings(), OutgoingEmail("a@example.com", "Subject", f"Open:\n\n{link}\n"))).decode()
    assert "Content-Transfer-Encoding: 8bit" in raw
    assert link in raw.splitlines()
