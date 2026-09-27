from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.services import reports as report_service
from app.services.dashboard import current_period
from tests.conftest import make_client, requires_db
from tests.test_auth import register
from tests.test_finance import add_expense, add_income, category_id

TODAY = current_period().today


@pytest.fixture
def user(client):
    register(client)
    return client


def get(client, report, **params):
    response = client.get(f"/api/reports/{report}", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def add_goal(client, name, target):
    return client.post("/api/savings-goals", json={"name": name, "target_amount": target, "current_amount": "0"}).json()


def contribute(client, goal, kind, amount, on):
    response = client.post(f"/api/savings-goals/{goal['id']}/contributions", json={"kind": kind, "amount": amount, "date": on})
    assert response.status_code == 200, response.text


# --- Periods and helpers (no database) ----------------------------------------------------------------------


def test_resolve_period():
    today = date(2026, 9, 27)
    month = report_service.resolve_period(today, month="2025-02")
    assert (month.kind, month.start, month.end, month.label) == ("month", date(2025, 2, 1), date(2025, 2, 28), "February 2025")
    assert month.months == ("2025-02",)
    # A single month shows the 6 months up to it in trend charts.
    assert month.trend_months == ("2024-09", "2024-10", "2024-11", "2024-12", "2025-01", "2025-02")
    year = report_service.resolve_period(today, year=2025)
    assert (year.start, year.end, len(year.months), year.trend_months == year.months) == (date(2025, 1, 1), date(2025, 12, 31), 12, True)
    custom = report_service.resolve_period(today, date_from=date(2025, 1, 15), date_to=date(2025, 3, 10), month="2024-01", year=2020)
    assert (custom.kind, custom.months) == ("range", ("2025-01", "2025-02", "2025-03"))  # dates win over month and year
    assert report_service.resolve_period(today, month="2024-01", year=2020).kind == "month"  # month wins over year
    default = report_service.resolve_period(today)
    assert (default.kind, default.start, default.end) == ("month", date(2026, 9, 1), date(2026, 9, 30))


@pytest.mark.parametrize(
    "kwargs",
    [
        {"date_from": date(2025, 1, 1)},
        {"date_to": date(2025, 1, 1)},
        {"date_from": date(2025, 2, 1), "date_to": date(2025, 1, 1)},
        {"date_from": date(2020, 1, 1), "date_to": date(2025, 12, 31)},
        {"year": 1999},
    ],
)
def test_resolve_period_rejects_bad_input(kwargs):
    with pytest.raises(report_service.ReportError):
        report_service.resolve_period(date(2026, 9, 27), **kwargs)


def test_previous_period():
    today = date(2026, 9, 27)
    assert report_service.previous_period(report_service.resolve_period(today, month="2025-01")) == (date(2024, 12, 1), date(2024, 12, 31))
    assert report_service.previous_period(report_service.resolve_period(today, year=2025)) == (date(2024, 1, 1), date(2024, 12, 31))
    custom = report_service.resolve_period(today, date_from=date(2025, 3, 11), date_to=date(2025, 3, 20))
    assert report_service.previous_period(custom) == (date(2025, 3, 1), date(2025, 3, 10))


def test_percent_and_change_never_invent_values():
    assert report_service.percent(Decimal("1"), Decimal("3")) == Decimal("33.3")
    assert report_service.percent(Decimal("2"), Decimal("3")) == Decimal("66.7")
    assert report_service.percent(Decimal("5"), Decimal("0")) is None
    assert report_service.change(Decimal("150"), Decimal("100")) == {"amount": Decimal("50"), "percent": Decimal("50.0")}
    assert report_service.change(Decimal("100"), Decimal("0")) == {"amount": Decimal("100"), "percent": None}


def test_csv_cells_block_formula_injection():
    content = report_service.to_csv(["A", "B"], [["=HYPERLINK(1)", Decimal("-8999.50")], ["+1", None], ["@x", "normal"]])
    assert content.startswith("﻿A,B\r\n")
    assert "'=HYPERLINK(1),-8999.50" in content  # text is neutralised, negative amounts stay numbers
    assert "'+1,\r\n" in content and "'@x,normal" in content


# --- Access and validation ----------------------------------------------------------------------------------


@requires_db
def test_reports_require_login(client):
    for report in ("finance", "expenses", "budget", "savings", "bills"):
        assert client.get(f"/api/reports/{report}").status_code == 401
    assert client.get("/api/reports/expenses/export.csv").status_code == 401


@requires_db
@pytest.mark.parametrize(
    "params",
    [
        {"month": "2025-13"},
        {"month": "Feb"},
        {"year": 1999},
        {"date_from": "2025-01-01"},
        {"date_from": "2025-02-01", "date_to": "2025-01-01"},
        {"date_from": "2019-01-01", "date_to": "2025-01-01"},
        {"category_id": "not-a-uuid"},
    ],
)
def test_report_validation(user, params):
    assert user.get("/api/reports/expenses", params=params).status_code == 422


@requires_db
def test_unknown_export_is_rejected(user):
    assert user.get("/api/reports/passwords/export.csv").status_code in (404, 422)


# --- Monthly finance ------------------------------------------------------------------------------------------


def seed_finance(client):
    add_income(client, "50000.00", date(2025, 1, 5))
    add_income(client, "50000.00", date(2025, 2, 5))
    add_income(client, "1000.50", date(2025, 2, 20), category="Freelance")
    add_expense(client, "20000.25", date(2025, 1, 10))
    add_expense(client, "60000.00", date(2025, 2, 12), category="Rent")
    goal = add_goal(client, "Emergency fund", "10000.00")
    contribute(client, goal, "deposit", "5000.00", "2025-02-10")
    contribute(client, goal, "withdrawal", "1000.00", "2025-02-20")


@requires_db
def test_finance_report_year(user):
    seed_finance(user)
    data = get(user, "finance", year=2025)
    assert data["currency"] == "NPR"
    assert data["totals"] == {
        "income": "101000.50",
        "expenses": "80000.25",
        "net": "21000.25",
        "savings_rate": "20.8",  # 21000.25 / 101000.50 = 20.79%
        "savings_deposits": "5000.00",
        "savings_withdrawals": "1000.00",
        "savings": "4000.00",
        "closing_balance": "21000.25",
        "balance_as_of": "2025-12-31",
    }
    months = {m["month"]: m for m in data["months"]}
    assert len(months) == 12
    assert months["2025-01"] == {"month": "2025-01", "income": "50000.00", "expenses": "20000.25", "net": "29999.75", "savings": "0.00", "balance": "29999.75"}
    assert months["2025-02"] == {"month": "2025-02", "income": "51000.50", "expenses": "60000.00", "net": "-8999.50", "savings": "4000.00", "balance": "21000.25"}
    assert months["2025-07"]["net"] == "0.00" and months["2025-07"]["balance"] == "21000.25"  # balance carries forward


@requires_db
def test_finance_single_month_and_no_income(user):
    seed_finance(user)
    data = get(user, "finance", month="2025-01")
    assert data["period"]["kind"] == "month" and data["totals"]["net"] == "29999.75"
    assert [m["month"] for m in data["months"]] == ["2024-08", "2024-09", "2024-10", "2024-11", "2024-12", "2025-01"]
    assert data["months"][0]["balance"] == "0.00"
    empty = get(user, "finance", month="2024-06")
    assert empty["totals"]["savings_rate"] is None  # no income: no made-up rate
    assert empty["totals"]["income"] == "0.00"


@requires_db
def test_finance_future_months_have_no_balance(user):
    add_income(user, "1000.00", TODAY)
    add_expense(user, "300.00", TODAY + timedelta(days=40))  # future-dated, not spent yet
    future = (TODAY.replace(day=1) + timedelta(days=100)).strftime("%Y-%m")
    data = get(user, "finance", month=future)
    assert data["totals"]["closing_balance"] is None and data["totals"]["balance_as_of"] is None
    assert data["months"][-1]["balance"] is None
    now = get(user, "finance")
    assert now["totals"]["closing_balance"] == "1000.00"  # never counts entries dated after today
    assert now["totals"]["balance_as_of"] == TODAY.isoformat()


# --- Expenses ----------------------------------------------------------------------------------------------------


def seed_expenses(client):
    add_expense(client, "500.00", date(2025, 1, 3))
    add_expense(client, "12000.00", date(2025, 1, 1), category="Rent", description="Room rent", is_recurring=True, recurrence_interval="monthly")
    add_expense(client, "80.00", date(2025, 1, 9), category="Groceries")
    add_expense(client, "100.00", date(2025, 2, 3), description="Lunch")
    add_expense(client, "200.00", date(2025, 2, 14), description="Dinner")
    add_expense(client, "12000.00", date(2025, 2, 1), category="Rent", description="Room rent", is_recurring=True, recurrence_interval="monthly")
    transport = client.post("/api/categories", json={"kind": "expense", "name": "Transport"}).json()
    client.post(
        "/api/expenses",
        json={"amount": "50.50", "date": "2025-02-20", "category_id": transport["id"], "payment_method": "cash", "description": "Bus"},
    )


@requires_db
def test_expense_report(user):
    seed_expenses(user)
    data = get(user, "expenses", month="2025-02")
    assert (data["total"], data["count"]) == ("12350.50", 4)
    rows = [(c["category"], c["amount"], c["count"], c["percent"], c["previous_amount"], c["change"]) for c in data["by_category"]]
    assert rows == [
        ("Rent", "12000.00", 1, "97.2", "12000.00", {"amount": "0.00", "percent": "0.0"}),
        ("Food", "300.00", 2, "2.4", "500.00", {"amount": "-200.00", "percent": "-40.0"}),
        ("Transport", "50.50", 1, "0.4", "0.00", {"amount": "50.50", "percent": None}),
        ("Groceries", "0.00", 0, "0.0", "80.00", {"amount": "-80.00", "percent": "-100.0"}),  # only last month
    ]
    assert data["previous"] == {"start": "2025-01-01", "end": "2025-01-31", "total": "12580.00", "change": {"amount": "-229.50", "percent": "-1.8"}}
    assert [(e["category"], e["amount"]) for e in data["largest"]] == [("Rent", "12000.00"), ("Food", "200.00"), ("Food", "100.00"), ("Transport", "50.50")]
    assert data["recurring"]["total"] == "12000.00" and data["recurring"]["count"] == 1
    assert data["recurring"]["percent_of_total"] == "97.2"
    assert data["recurring"]["items"][0] == {
        "category": "Rent", "description": "Room rent", "interval": "monthly", "count": 1, "total": "12000.00", "last_amount": "12000.00", "last_date": "2025-02-01",
    }
    monthly = data["monthly"]
    assert [m["month"] for m in monthly][-2:] == ["2025-01", "2025-02"]
    assert monthly[0]["change"] is None
    assert monthly[-1] == {"month": "2025-02", "amount": "12350.50", "change": {"amount": "-229.50", "percent": "-1.8"}}
    assert monthly[-2]["change"] == {"amount": "12580.00", "percent": None}  # from 0 in December


@requires_db
def test_expense_report_category_filter_and_year(user):
    seed_expenses(user)
    food = category_id(user, "expense", "Food")
    data = get(user, "expenses", month="2025-02", category_id=food)
    assert data["total"] == "300.00" and [c["category"] for c in data["by_category"]] == ["Food"]
    assert data["previous"]["total"] == "500.00"
    assert data["recurring"]["total"] == "0.00" and data["recurring"]["percent_of_total"] == "0.0"
    year = get(user, "expenses", year=2025)
    assert year["total"] == "24930.50" and year["recurring"]["count"] == 2
    assert year["recurring"]["items"][0]["count"] == 2 and year["recurring"]["items"][0]["total"] == "24000.00"
    empty = get(user, "expenses", year=2024)
    assert empty["total"] == "0.00" and empty["recurring"]["percent_of_total"] is None


# --- Budget -------------------------------------------------------------------------------------------------------


def add_budget(client, category, month, amount):
    response = client.post("/api/budgets", json={"category_id": category_id(client, "expense", category), "month": month, "amount": amount})
    assert response.status_code == 201, response.text


@requires_db
def test_budget_report(user):
    seed_expenses(user)
    add_budget(user, "Food", "2025-02", "1000.00")
    add_budget(user, "Rent", "2025-02", "12000.00")
    add_budget(user, "Food", "2025-01", "400.00")
    data = get(user, "budget", month="2025-02")
    assert data["whole_months"] is True
    assert data["totals"] == {"budget": "13000.00", "spent": "12300.00", "remaining": "700.00", "percent_used": "94.6", "unbudgeted_spent": "50.50"}
    cats = {c["category"]: c for c in data["categories"]}
    assert cats["Food"]["percent_used"] == "30.0" and cats["Food"]["remaining"] == "700.00"
    assert cats["Rent"]["percent_used"] == "100.0" and cats["Rent"]["months_over"] == 0  # exactly on budget isn't over

    year = get(user, "budget", year=2025)
    assert year["totals"]["budget"] == "13400.00" and year["totals"]["spent"] == "12800.00"
    assert year["totals"]["remaining"] == "600.00" and year["totals"]["percent_used"] == "95.5"
    food = next(c for c in year["categories"] if c["category"] == "Food")
    # Only months where Food had a budget are compared (Jan 500 of 400, Feb 300 of 1000).
    assert (food["budget"], food["spent"], food["months_budgeted"], food["months_over"]) == ("1400.00", "800.00", 2, 1)
    months = {m["month"]: m for m in year["months"]}
    assert months["2025-01"]["over_budget"] == 1 and months["2025-01"]["unbudgeted_spent"] == "12080.00"
    assert months["2025-05"]["budget"] == "0.00" and months["2025-05"]["percent_used"] is None

    only_rent = get(user, "budget", month="2025-02", category_id=category_id(user, "expense", "Rent"))
    assert only_rent["totals"]["budget"] == "12000.00" and only_rent["totals"]["unbudgeted_spent"] is None


# --- Savings --------------------------------------------------------------------------------------------------------


@requires_db
def test_savings_report(user):
    emergency = add_goal(user, "Emergency fund", "10000.00")
    laptop = add_goal(user, "Laptop", "2000.00")
    contribute(user, emergency, "deposit", "5000.00", "2025-02-10")
    contribute(user, emergency, "withdrawal", "1000.00", "2025-02-20")
    contribute(user, laptop, "deposit", "2500.00", "2025-03-01")
    data = get(user, "savings", year=2025)
    assert data["totals"] == {
        "deposits": "7500.00", "withdrawals": "1000.00", "net": "6500.00", "total_saved": "6500.00",
        "total_target": "12000.00", "progress_percent": "54.2", "goals": 2, "completed_goals": 1,
    }
    months = {m["month"]: m for m in data["months"]}
    assert months["2025-01"] == {"month": "2025-01", "deposits": "0.00", "withdrawals": "0.00", "net": "0.00", "total_saved": "0.00"}
    assert months["2025-02"] == {"month": "2025-02", "deposits": "5000.00", "withdrawals": "1000.00", "net": "4000.00", "total_saved": "4000.00"}
    assert months["2025-03"]["total_saved"] == "6500.00" and months["2025-12"]["total_saved"] == "6500.00"
    goals = {g["name"]: g for g in data["goals"]}
    assert goals["Emergency fund"]["saved_in_period"] == "4000.00" and goals["Emergency fund"]["progress_percent"] == "40.0"
    assert goals["Laptop"]["completed"] is True and goals["Laptop"]["progress_percent"] == "125.0"
    march = get(user, "savings", month="2025-03")
    assert march["totals"]["net"] == "2500.00"
    assert {g["name"]: g["saved_in_period"] for g in march["goals"]} == {"Emergency fund": "0.00", "Laptop": "2500.00"}


@requires_db
def test_savings_report_without_goals(user):
    data = get(user, "savings")
    assert data["goals"] == [] and data["totals"]["progress_percent"] is None


# --- Bills -------------------------------------------------------------------------------------------------------------


def add_bill(client, name, amount, category, due, frequency):
    response = client.post("/api/bills", json={"name": name, "amount": amount, "category": category, "due_date": due.isoformat(), "frequency": frequency})
    assert response.status_code == 201, response.text
    return response.json()


@requires_db
def test_bills_report(user):
    add_bill(user, "Room rent", "12000.00", "rent", TODAY - timedelta(days=10), "monthly")  # overdue
    add_bill(user, "Wi-Fi", "1500.00", "wifi", TODAY + timedelta(days=3), "one_time")
    add_bill(user, "Milk", "700.00", "other", TODAY + timedelta(days=2), "weekly")
    electricity = add_bill(user, "Electricity", "1500.25", "electricity", TODAY - timedelta(days=20), "monthly")
    paid = user.post(f"/api/bills/{electricity['id']}/pay", json={"paid_on": (TODAY - timedelta(days=20)).isoformat()})
    assert paid.status_code == 200

    params = {"date_from": (TODAY - timedelta(days=60)).isoformat(), "date_to": (TODAY + timedelta(days=30)).isoformat()}
    data = get(user, "bills", **params)
    assert data["paid"]["total"] == "1500.25" and data["paid"]["count"] == 1
    assert data["paid"]["by_bill"] == [{"bill_id": electricity["id"], "name": "Electricity", "category": "electricity", "count": 1, "total": "1500.25"}]
    assert data["overdue"]["total"] == "12000.00" and [b["name"] for b in data["overdue"]["items"]] == ["Room rent"]
    # Unpaid bills due in the period: Wi-Fi, Milk and Electricity's next cycle.
    assert data["pending"]["total"] == "3700.25" and data["pending"]["count"] == 3
    recurring = data["recurring"]
    assert recurring["count"] == 3  # the one-time Wi-Fi bill isn't recurring
    assert {f["frequency"]: (f["count"], f["per_cycle"], f["per_year"]) for f in recurring["by_frequency"]} == {
        "weekly": (1, "700.00", "36400.00"),
        "monthly": (2, "13500.25", "162003.00"),
    }
    assert recurring["yearly_total"] == "198403.00" and recurring["monthly_average"] == "16533.58"
    assert sum(Decimal(m["amount"]) for m in data["monthly_paid"]) == Decimal("1500.25")

    rent_only = get(user, "bills", category="rent", **params)
    assert rent_only["paid"]["total"] == "0.00" and rent_only["overdue"]["count"] == 1 and rent_only["pending"]["count"] == 0
    assert user.get("/api/reports/bills", params={"category": "casino"}).status_code == 422


# --- CSV export and privacy -----------------------------------------------------------------------------------------


@requires_db
def test_csv_exports(user):
    seed_expenses(user)
    add_expense(user, "10.00", date(2025, 2, 25), description="=HYPERLINK(\"http://evil\")")
    response = user.get("/api/reports/expenses/export.csv", params={"month": "2025-02"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert 'attachment; filename="lifevault-expenses-2025-02-01-to-2025-02-28.csv"' == response.headers["content-disposition"]
    assert response.headers["cache-control"] == "private, no-store"
    lines = response.content.decode("utf-8-sig").splitlines()
    assert lines[0] == "Date,Category,Description,Amount,Currency,Payment method,Recurring,Interval"
    assert len(lines) == 6
    assert "2025-02-01,Rent,Room rent,12000.00,NPR,cash,yes,monthly" in lines
    assert any(line.startswith("2025-02-25,Food,\"'=HYPERLINK") for line in lines)

    finance = user.get("/api/reports/finance/export.csv", params={"year": 2025}).content.decode("utf-8-sig").splitlines()
    assert finance[0].startswith("Month,Income,Expenses") and len(finance) == 13
    for report in ("budget", "savings", "bills"):
        assert user.get(f"/api/reports/{report}/export.csv", params={"year": 2025}).status_code == 200


@requires_db
def test_reports_only_include_your_own_data(user):
    seed_finance(user)
    seed_expenses(user)
    other = make_client()
    register(other, username="other", email="other@example.com")
    assert get(other, "finance", year=2025)["totals"]["income"] == "0.00"
    assert get(other, "expenses", year=2025)["total"] == "0.00"
    assert get(other, "savings", year=2025)["goals"] == []
    csv_lines = other.get("/api/reports/expenses/export.csv", params={"year": 2025}).content.decode("utf-8-sig").splitlines()
    assert len(csv_lines) == 1  # header only
