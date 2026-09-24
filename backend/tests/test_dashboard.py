from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from app.schemas.common import Money
from app.services.dashboard import current_period
from tests.conftest import requires_db
from tests.test_auth import register


@requires_db
def test_dashboard_requires_authentication(client):
    response = client.get("/api/dashboard/summary")
    assert response.status_code == 401


@requires_db
def test_dashboard_summary_for_signed_in_user(client):
    register(client)
    response = client.get("/api/dashboard/summary")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    body = response.json()
    assert body["currency"] == "NPR"
    assert body["period"]["timezone"] == "Asia/Kathmandu"


@requires_db
def test_unbuilt_modules_report_no_data_instead_of_fake_numbers(client):
    register(client)
    body = client.get("/api/dashboard/summary").json()

    finance = body["finance"]
    assert finance["available"] is False and finance["available_from_phase"] == 4
    for field in ("monthly_income", "monthly_expenses", "current_balance", "savings", "budget_remaining"):
        assert finance[field] is None

    assert body["tasks"] == {"available": False, "available_from_phase": 6, "today": [], "pending": [], "overdue": []}
    assert body["bills"] == {"available": False, "available_from_phase": 5, "upcoming": [], "overdue": []}
    assert body["reminders"] == {"available": False, "available_from_phase": 6, "upcoming": []}
    charts = body["charts"]
    assert charts["available"] is False
    assert all(charts[k] == [] for k in ("income_vs_expenses", "expense_categories", "monthly_spending", "savings"))


@pytest.mark.parametrize(
    ("utc_now", "expected_today", "expected_start", "expected_end"),
    [
        # 18:30 UTC on 31 Jan is already 1 Feb 00:15 in Kathmandu (UTC+05:45).
        (datetime(2026, 1, 31, 18, 30, tzinfo=UTC), date(2026, 2, 1), date(2026, 2, 1), date(2026, 2, 28)),
        (datetime(2028, 2, 10, 12, 0, tzinfo=UTC), date(2028, 2, 10), date(2028, 2, 1), date(2028, 2, 29)),  # leap year
        (datetime(2026, 12, 31, 12, 0, tzinfo=UTC), date(2026, 12, 31), date(2026, 12, 1), date(2026, 12, 31)),
    ],
)
def test_period_uses_app_timezone(utc_now, expected_today, expected_start, expected_end):
    period = current_period(utc_now)
    assert (period.today, period.start, period.end) == (expected_today, expected_start, expected_end)


def test_money_serializes_as_exact_decimal_string():
    assert Money(amount=Decimal("1234567.50"), currency="NPR").model_dump(mode="json") == {
        "amount": "1234567.50",
        "currency": "NPR",
    }
    assert Money(amount=Decimal("0.10") + Decimal("0.20"), currency="NPR").model_dump(mode="json")["amount"] == "0.30"
