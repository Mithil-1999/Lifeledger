from datetime import date
from decimal import Decimal

import pytest

from app.services.dashboard import current_period
from app.services.ledger import month_bounds, shift_month
from tests.conftest import make_client, requires_db
from tests.test_auth import register

pytestmark = requires_db

TODAY = current_period().today
THIS_MONTH = TODAY.strftime("%Y-%m")
LAST_MONTH = shift_month(THIS_MONTH, -1)


def category_id(client, kind: str, name: str) -> str:
    categories = client.get("/api/categories", params={"kind": kind}).json()
    return next(c["id"] for c in categories if c["name"] == name)


def add_income(client, amount="1000.00", day: date = TODAY, category="Salary", **extra):
    payload = {
        "amount": amount,
        "date": day.isoformat(),
        "source": "Acme Pvt. Ltd.",
        "category_id": category_id(client, "income", category),
        "payment_method": "bank_transfer",
        **extra,
    }
    return client.post("/api/incomes", json=payload)


def add_expense(client, amount="100.00", day: date = TODAY, category="Food", **extra):
    payload = {
        "amount": amount,
        "date": day.isoformat(),
        "category_id": category_id(client, "expense", category),
        "payment_method": "cash",
        **extra,
    }
    return client.post("/api/expenses", json=payload)


@pytest.fixture
def user(client):
    register(client)
    return client


# --- Categories --------------------------------------------------------------------------


def test_builtin_categories_are_seeded(user):
    income = [c["name"] for c in user.get("/api/categories", params={"kind": "income"}).json()]
    expense = [c["name"] for c in user.get("/api/categories", params={"kind": "expense"}).json()]
    # Alphabetical for easy scanning, with the catch-all "Other" last.
    assert income == ["Allowance", "Business", "Freelance", "Gift", "Investment", "Salary", "Other"]
    assert len(expense) == 22 and "Internet/Wi-Fi" in expense and expense[-1] == "Other"


def test_custom_expense_category_lifecycle(user):
    created = user.post("/api/categories", json={"kind": "expense", "name": "  Pets  "})
    assert created.status_code == 201
    cat = created.json()
    assert cat["name"] == "Pets" and cat["is_system"] is False

    assert user.post("/api/categories", json={"kind": "expense", "name": "pets"}).status_code == 409
    assert user.post("/api/categories", json={"kind": "expense", "name": "RENT"}).status_code == 409  # built-in clash

    renamed = user.patch(f"/api/categories/{cat['id']}", json={"name": "Pet care"})
    assert renamed.json()["name"] == "Pet care"

    assert add_expense(user, category="Pet care").status_code == 201
    in_use = user.delete(f"/api/categories/{cat['id']}")
    assert in_use.status_code == 409 and "used by 1 record" in in_use.json()["detail"]


def test_builtin_categories_cannot_be_modified(user):
    rent = category_id(user, "expense", "Rent")
    assert user.patch(f"/api/categories/{rent}", json={"name": "Housing"}).status_code == 403
    assert user.delete(f"/api/categories/{rent}").status_code == 403


def test_custom_categories_are_private(user):
    cat = user.post("/api/categories", json={"kind": "expense", "name": "Secret hobby"}).json()
    other = make_client()
    register(other, username="other", email="other@example.com")
    names = [c["name"] for c in other.get("/api/categories", params={"kind": "expense"}).json()]
    assert "Secret hobby" not in names
    assert other.delete(f"/api/categories/{cat['id']}").status_code == 404
    response = other.post(
        "/api/expenses",
        json={"amount": "1.00", "date": TODAY.isoformat(), "category_id": cat["id"], "payment_method": "cash"},
    )
    assert response.status_code == 422


# --- CRUD ----------------------------------------------------------------------------------


def test_income_crud(user):
    created = add_income(user, amount="85000.50", description="September salary", notes="Includes Dashain bonus")
    assert created.status_code == 201
    income = created.json()
    assert income["amount"] == "85000.50" and income["currency"] == "NPR"
    assert income["category"]["name"] == "Salary" and income["source"] == "Acme Pvt. Ltd."

    assert user.get(f"/api/incomes/{income['id']}").json()["description"] == "September salary"

    updated = user.put(
        f"/api/incomes/{income['id']}",
        json={
            "amount": "90000",
            "date": TODAY.isoformat(),
            "source": "Acme",
            "category_id": category_id(user, "income", "Business"),
            "payment_method": "mobile_wallet",
            "is_recurring": True,
            "recurrence_interval": "monthly",
        },
    ).json()
    assert updated["amount"] == "90000.00" and updated["category"]["name"] == "Business"
    assert updated["is_recurring"] is True and updated["recurrence_interval"] == "monthly"
    assert updated["description"] is None  # PUT replaces the record

    assert user.delete(f"/api/incomes/{income['id']}").status_code == 204
    assert user.get(f"/api/incomes/{income['id']}").status_code == 404


def test_expense_crud(user):
    expense = add_expense(user, amount="250.75", category="Groceries", description="Bhatbhateni").json()
    assert expense["amount"] == "250.75" and expense["category"]["name"] == "Groceries"
    edited = user.put(
        f"/api/expenses/{expense['id']}",
        json={"amount": "300", "date": TODAY.isoformat(), "category_id": expense["category"]["id"], "payment_method": "card"},
    )
    assert edited.json()["amount"] == "300.00"
    assert user.delete(f"/api/expenses/{expense['id']}").status_code == 204


def test_records_are_isolated_between_users(user):
    mine = add_expense(user).json()
    other = make_client()
    register(other, username="other", email="other@example.com")
    assert other.get(f"/api/expenses/{mine['id']}").status_code == 404
    assert other.delete(f"/api/expenses/{mine['id']}").status_code == 404
    assert other.get("/api/expenses").json()["total_count"] == 0
    assert user.get(f"/api/expenses/{mine['id']}").status_code == 200


def test_requires_authentication(client):
    assert client.get("/api/incomes").status_code == 401
    assert client.get("/api/categories").status_code == 401


# --- Validation ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "fragment"),
    [
        ({"amount": "0"}, "greater than 0"),
        ({"amount": "-5"}, "greater than 0"),
        ({"amount": "10.005"}, "decimal places"),
        ({"amount": "1000000000000"}, "no more than 12 digits"),
        ({"amount": "abc"}, "valid decimal"),
        ({"currency": "USD"}, "Currency must be one of"),
        ({"date": "1999-12-31"}, "Date must be between"),
        ({"payment_method": "gold"}, "Input should be"),
        ({"is_recurring": True}, "how often"),
        ({"source": "   "}, "at least 1 character"),
        ({"notes": "x" * 2001}, "at most 2000"),
    ],
)
def test_income_validation(user, overrides, fragment):
    response = add_income(user, **overrides)
    assert response.status_code == 422
    assert fragment in " ".join(e["msg"] for e in response.json()["errors"])


def test_category_must_match_kind(user):
    response = user.post(
        "/api/expenses",
        json={
            "amount": "10",
            "date": TODAY.isoformat(),
            "category_id": category_id(user, "income", "Salary"),
            "payment_method": "cash",
        },
    )
    assert response.status_code == 422 and "valid expense category" in response.json()["detail"]


def test_non_recurring_clears_interval(user):
    income = add_income(user, is_recurring=False, recurrence_interval="monthly").json()
    assert income["recurrence_interval"] is None


# --- Listing, filtering, totals -----------------------------------------------------------


def test_filtering_search_sorting_and_totals(user):
    add_expense(user, "120.10", category="Food", description="Momo at Thamel")
    add_expense(user, "80.20", category="Food", payment_method="mobile_wallet", description="Tea")
    add_expense(user, "2500.00", category="Electricity", notes="NEA bill")
    add_expense(user, "999.99", day=date(TODAY.year - 1, 6, 1), category="Travel")

    all_ = user.get("/api/expenses").json()
    assert all_["total_count"] == 4
    # Exact decimal sum (0.1 + 0.2 style amounts would drift with floats).
    assert all_["total_amount"] == "3700.29"
    assert [i["amount"] for i in all_["items"]][:3] != []

    food = user.get("/api/expenses", params={"category_id": category_id(user, "expense", "Food")}).json()
    assert food["total_count"] == 2 and food["total_amount"] == "200.30"

    wallet = user.get("/api/expenses", params={"payment_method": "mobile_wallet"}).json()
    assert [i["description"] for i in wallet["items"]] == ["Tea"]

    assert user.get("/api/expenses", params={"search": "momo"}).json()["total_count"] == 1
    assert user.get("/api/expenses", params={"search": "nea"}).json()["total_count"] == 1  # notes
    assert user.get("/api/expenses", params={"search": "electric"}).json()["total_count"] == 1  # category name
    assert user.get("/api/expenses", params={"search": "100%"}).json()["total_count"] == 0  # LIKE chars escaped

    start, end = month_bounds(THIS_MONTH)
    this_month = user.get("/api/expenses", params={"date_from": start.isoformat(), "date_to": end.isoformat()}).json()
    assert this_month["total_count"] == 3 and this_month["total_amount"] == "2700.30"

    ranged = user.get("/api/expenses", params={"min_amount": "100", "max_amount": "1000"}).json()
    assert sorted(i["amount"] for i in ranged["items"]) == ["120.10", "999.99"]

    by_amount = user.get("/api/expenses", params={"sort": "amount_desc"}).json()["items"]
    assert [i["amount"] for i in by_amount] == ["2500.00", "999.99", "120.10", "80.20"]

    page2 = user.get("/api/expenses", params={"page": 2, "page_size": 3, "sort": "amount_desc"}).json()
    assert [i["amount"] for i in page2["items"]] == ["80.20"]
    assert page2["total_count"] == 4 and page2["total_amount"] == "3700.29"  # totals ignore paging


def test_list_parameter_validation(user):
    assert user.get("/api/expenses", params={"page_size": 101}).status_code == 422
    assert user.get("/api/expenses", params={"sort": "random"}).status_code == 422
    bad_range = user.get("/api/expenses", params={"date_from": "2026-09-10", "date_to": "2026-09-01"})
    assert bad_range.status_code == 422


def test_recurring_filter(user):
    add_income(user, is_recurring=True, recurrence_interval="monthly")
    add_income(user, category="Gift")
    recurring = user.get("/api/incomes", params={"is_recurring": "true"}).json()
    assert recurring["total_count"] == 1 and recurring["items"][0]["category"]["name"] == "Salary"


# --- Monthly / yearly summaries -------------------------------------------------------------


def test_year_summary_monthly_and_category_totals(user):
    year = TODAY.year
    add_income(user, "50000.00", day=date(year, 1, 31))
    add_income(user, "50000.00", day=date(year, 2, 1))
    add_income(user, "0.10", day=date(year, 2, 28), category="Gift")
    add_income(user, "0.20", day=date(year, 2, 28), category="Gift")
    add_income(user, "7777.00", day=date(year - 1, 12, 31))  # other year: excluded

    summary = user.get("/api/incomes/summary", params={"year": year}).json()
    assert summary["year"] == year and summary["currency"] == "NPR"
    assert len(summary["months"]) == 12
    months = {m["month"]: m for m in summary["months"]}
    assert months[f"{year}-01"] == {"month": f"{year}-01", "total": "50000.00", "count": 1}
    assert months[f"{year}-02"]["total"] == "50000.30"  # exact: 0.10 + 0.20 == 0.30
    assert months[f"{year}-03"]["total"] == "0.00"
    assert summary["year_total"] == "100000.30" and summary["year_count"] == 4
    assert [(c["category"], c["total"]) for c in summary["by_category"]] == [("Salary", "100000.00"), ("Gift", "0.30")]

    previous = user.get("/api/incomes/summary", params={"year": year - 1}).json()
    assert previous["year_total"] == "7777.00"


def test_current_month_total_in_summary(user):
    add_expense(user, "300.00")
    add_expense(user, "200.00", day=month_bounds(LAST_MONTH)[0])
    summary = user.get("/api/expenses/summary").json()
    assert summary["current_month"] == THIS_MONTH
    assert summary["current_month_total"] == "300.00"


# --- Dashboard integration ------------------------------------------------------------------


def test_dashboard_uses_real_income_and_expenses(user):
    add_income(user, "85000.00")
    add_income(user, "15000.00", day=month_bounds(LAST_MONTH)[0], category="Freelance")
    add_expense(user, "12000.00", category="Rent")
    add_expense(user, "3000.50", category="Food")
    add_expense(user, "500.00", day=month_bounds(LAST_MONTH)[0], category="Mobile")

    body = user.get("/api/dashboard/summary").json()
    finance = body["finance"]
    assert finance["monthly_income"]["amount"] == "85000.00"
    assert finance["monthly_expenses"]["amount"] == "15000.50"
    # All-time balance: 100000.00 - 15500.50
    assert finance["current_balance"]["amount"] == "84499.50"

    charts = body["charts"]
    assert [(c["category"], c["amount"]) for c in charts["expense_categories"]] == [("Rent", "12000.00"), ("Food", "3000.50")]
    trend = {p["month"]: p for p in charts["income_vs_expenses"]}
    assert len(charts["income_vs_expenses"]) == 6
    assert trend[THIS_MONTH]["income"] == "85000.00" and trend[THIS_MONTH]["expenses"] == "15000.50"
    assert trend[LAST_MONTH]["income"] == "15000.00" and trend[LAST_MONTH]["expenses"] == "500.00"
    assert {p["month"]: p["expenses"] for p in charts["monthly_spending"]}[THIS_MONTH] == "15000.50"


def test_future_dated_entries_excluded_from_balance(user):
    add_income(user, "1000.00")
    future = date.fromordinal(TODAY.toordinal() + 40)
    add_expense(user, "400.00", day=future)
    assert user.get("/api/dashboard/summary").json()["finance"]["current_balance"]["amount"] == "1000.00"


def test_dashboard_is_per_user(user):
    add_income(user, "5000.00")
    other = make_client()
    register(other, username="other", email="other@example.com")
    assert other.get("/api/dashboard/summary").json()["finance"]["monthly_income"]["amount"] == "0.00"


def test_month_helpers():
    assert shift_month("2026-01", -1) == "2025-12"
    assert shift_month("2026-12", 1) == "2027-01"
    assert month_bounds("2028-02") == (date(2028, 2, 1), date(2028, 2, 29))
    assert sum([Decimal("0.10"), Decimal("0.20")]) == Decimal("0.30")
