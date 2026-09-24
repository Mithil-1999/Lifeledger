from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.services.bills import add_months, next_due_date
from app.services.budgets import budget_status, percent
from app.services.dashboard import current_period
from app.services.ledger import month_bounds, shift_month
from app.services.savings import months_left
from tests.conftest import make_client, requires_db
from tests.test_auth import register
from tests.test_finance import add_expense, category_id

TODAY = current_period().today
THIS_MONTH = TODAY.strftime("%Y-%m")
LAST_MONTH = shift_month(THIS_MONTH, -1)
NEXT_MONTH = shift_month(THIS_MONTH, 1)


@pytest.fixture
def user(client):
    register(client)
    return client


def other_user():
    other = make_client()
    register(other, username="other", email="other@example.com")
    return other


# --- Pure calculations ----------------------------------------------------------------------------


def test_percent_and_budget_status():
    assert percent(Decimal("0.10") + Decimal("0.20"), Decimal("0.90")) == Decimal("33.3")
    assert percent(Decimal("875"), Decimal("1000")) == Decimal("87.5")
    assert percent(Decimal("5"), Decimal("0")) == Decimal("0.0")
    assert budget_status(Decimal("799.99"), Decimal("1000"), 80) == "ok"
    assert budget_status(Decimal("800"), Decimal("1000"), 80) == "warning"
    assert budget_status(Decimal("1000"), Decimal("1000"), 80) == "warning"  # exactly on budget
    assert budget_status(Decimal("1000.01"), Decimal("1000"), 80) == "over"


def test_bill_due_date_advancing():
    assert next_due_date(date(2026, 9, 24), "weekly", 24) == date(2026, 10, 1)
    # Due on the 31st: clamps in short months, then returns to the 31st.
    d = date(2026, 1, 31)
    d = next_due_date(d, "monthly", 31)
    assert d == date(2026, 2, 28)
    d = next_due_date(d, "monthly", 31)
    assert d == date(2026, 3, 31)
    assert next_due_date(date(2026, 11, 30), "quarterly", 30) == date(2027, 2, 28)
    assert next_due_date(date(2028, 2, 29), "yearly", 29) == date(2029, 2, 28)
    assert add_months(date(2026, 12, 15), 1, 15) == date(2027, 1, 15)


def test_months_left():
    assert months_left(date(2026, 9, 24), date(2026, 12, 31)) == 4  # Sep..Dec
    assert months_left(date(2026, 9, 24), date(2026, 12, 1)) == 3
    assert months_left(date(2026, 9, 24), date(2026, 9, 30)) == 1


# --- Budgets -------------------------------------------------------------------------------------------


def create_budget(client, category="Food", amount="1000.00", month=THIS_MONTH, threshold=80):
    return client.post(
        "/api/budgets",
        json={"category_id": category_id(client, "expense", category), "month": month, "amount": amount, "warning_threshold": threshold},
    )


def test_budget_crud_and_spent_calculation(user):
    add_expense(user, "600.10", category="Food")
    add_expense(user, "250.20", category="Food")
    add_expense(user, "99.00", day=month_bounds(LAST_MONTH)[0], category="Food")  # other month
    add_expense(user, "5000.00", category="Rent")  # no budget -> unbudgeted

    created = create_budget(user, amount="1000.00")
    assert created.status_code == 201
    budget = created.json()
    assert budget["spent"] == "850.30" and budget["remaining"] == "149.70"
    assert budget["percent_used"] == "85.0" and budget["status"] == "warning"

    month = user.get("/api/budgets", params={"month": THIS_MONTH}).json()
    assert month["total_budget"] == "1000.00" and month["total_spent"] == "850.30"
    assert month["total_remaining"] == "149.70" and month["unbudgeted_spent"] == "5000.00"

    updated = user.put(f"/api/budgets/{budget['id']}", json={"amount": "800", "warning_threshold": 90}).json()
    assert updated["remaining"] == "-50.30" and updated["status"] == "over" and updated["warning_threshold"] == 90

    assert user.delete(f"/api/budgets/{budget['id']}").status_code == 204
    assert user.get("/api/budgets", params={"month": THIS_MONTH}).json()["budgets"] == []


def test_budget_validation_and_uniqueness(user):
    assert create_budget(user).status_code == 201
    assert create_budget(user).status_code == 409
    assert create_budget(user, amount="0").status_code == 422
    assert create_budget(user, threshold=0).status_code == 422
    assert create_budget(user, threshold=101).status_code == 422
    assert create_budget(user, month="2026-13").status_code == 422
    income_cat = user.post(
        "/api/budgets",
        json={"category_id": category_id(user, "income", "Salary"), "month": THIS_MONTH, "amount": "5"},
    )
    assert income_cat.status_code == 422
    assert user.get("/api/budgets", params={"month": "bad"}).status_code == 422


def test_copy_budgets_to_next_month(user):
    create_budget(user, "Food", "1000")
    create_budget(user, "Rent", "12000", threshold=95)
    create_budget(user, "Food", "1500", month=NEXT_MONTH)  # already exists there -> skipped
    result = user.post("/api/budgets/copy", json={"from_month": THIS_MONTH, "to_month": NEXT_MONTH}).json()
    assert result == {"copied": 1, "skipped": 1}
    next_budgets = {b["category"]["name"]: b for b in user.get("/api/budgets", params={"month": NEXT_MONTH}).json()["budgets"]}
    assert next_budgets["Food"]["amount"] == "1500.00"  # not overwritten
    assert next_budgets["Rent"]["amount"] == "12000.00" and next_budgets["Rent"]["warning_threshold"] == 95
    same = user.post("/api/budgets/copy", json={"from_month": THIS_MONTH, "to_month": THIS_MONTH})
    assert same.status_code == 422


def test_budgets_are_private(user):
    budget = create_budget(user).json()
    other = other_user()
    assert other.get("/api/budgets").json()["budgets"] == []
    assert other.put(f"/api/budgets/{budget['id']}", json={"amount": "1"}).status_code == 404
    assert other.delete(f"/api/budgets/{budget['id']}").status_code == 404


def test_budgeted_custom_category_cannot_be_deleted(user):
    cat = user.post("/api/categories", json={"kind": "expense", "name": "Pets"}).json()
    user.post("/api/budgets", json={"category_id": cat["id"], "month": THIS_MONTH, "amount": "500"})
    response = user.delete(f"/api/categories/{cat['id']}")
    assert response.status_code == 409 and "budget" in response.json()["detail"]


# --- Bills ----------------------------------------------------------------------------------------------


def create_bill(client, name="Room rent", amount="12000.00", category="rent", due=None, frequency="monthly", **extra):
    return client.post(
        "/api/bills",
        json={
            "name": name,
            "amount": amount,
            "category": category,
            "due_date": (due or TODAY + timedelta(days=5)).isoformat(),
            "frequency": frequency,
            **extra,
        },
    )


def test_bill_crud(user):
    created = create_bill(user, notes="Pay landlord by eSewa")
    assert created.status_code == 201
    bill = created.json()
    assert bill["status"] == "pending" and bill["days_until_due"] == 5 and bill["last_paid_on"] is None

    edited = user.put(
        f"/api/bills/{bill['id']}",
        json={"name": "Rent", "amount": "13000", "category": "rent", "due_date": bill["due_date"], "frequency": "monthly"},
    ).json()
    assert edited["amount"] == "13000.00" and edited["name"] == "Rent" and edited["notes"] is None

    assert user.get(f"/api/bills/{bill['id']}").status_code == 200
    assert user.delete(f"/api/bills/{bill['id']}").status_code == 204
    assert user.get(f"/api/bills/{bill['id']}").status_code == 404


@pytest.mark.parametrize(
    ("overrides", "status_code"),
    [
        ({"amount": "0"}, 422),
        ({"category": "gym"}, 422),
        ({"frequency": "daily"}, 422),
        ({"name": ""}, 422),
        ({"status": "overdue"}, 422),  # overdue is derived, never set
        ({"status": "paid"}, 422),  # recurring bills can't be created as paid
    ],
)
def test_bill_validation(user, overrides, status_code):
    assert create_bill(user, **overrides).status_code == status_code


def test_overdue_is_derived_and_filterable(user):
    create_bill(user, "Electricity", "1850.50", "electricity", due=TODAY - timedelta(days=3))
    create_bill(user, "Wi-Fi", "1500.00", "wifi", due=TODAY + timedelta(days=10))
    create_bill(user, "Insurance", "20000.00", "insurance", due=TODAY + timedelta(days=90), frequency="yearly")
    create_bill(user, "Old repair", "700.00", "other", due=TODAY - timedelta(days=40), frequency="one_time", status="paid")

    overview = user.get("/api/bills").json()
    assert [(b["name"], b["status"]) for b in overview["items"]] == [
        ("Electricity", "overdue"),
        ("Wi-Fi", "pending"),
        ("Insurance", "pending"),
        ("Old repair", "paid"),
    ]
    assert overview["overdue_count"] == 1 and overview["overdue_total"] == "1850.50"
    assert overview["due_soon_count"] == 1 and overview["due_soon_total"] == "1500.00"  # insurance is 90 days out

    assert [b["name"] for b in user.get("/api/bills", params={"status": "overdue"}).json()["items"]] == ["Electricity"]
    assert [b["name"] for b in user.get("/api/bills", params={"category": "wifi"}).json()["items"]] == ["Wi-Fi"]


def test_paying_a_recurring_bill_moves_it_to_the_next_cycle(user):
    due = date(TODAY.year, TODAY.month, 1)
    bill = create_bill(user, due=due).json()
    paid = user.post(f"/api/bills/{bill['id']}/pay", json={"paid_on": TODAY.isoformat()}).json()
    assert paid["due_date"] == add_months(due, 1, 1).isoformat()
    assert paid["status"] == "pending" and paid["last_paid_on"] == TODAY.isoformat()

    payments = user.get(f"/api/bills/{bill['id']}/payments").json()
    assert len(payments) == 1 and payments[0]["amount"] == "12000.00" and payments[0]["due_date"] == due.isoformat()
    assert payments[0]["expense_id"] is None
    assert user.get("/api/expenses").json()["total_count"] == 0  # no expense unless asked


def test_paying_can_record_the_expense_in_the_matching_category(user):
    bill = create_bill(user, "Worldlink", "1500.00", "wifi").json()
    user.post(
        f"/api/bills/{bill['id']}/pay",
        json={"paid_on": TODAY.isoformat(), "amount": "1450.75", "record_expense": True, "payment_method": "mobile_wallet"},
    )
    expenses = user.get("/api/expenses").json()
    assert expenses["total_amount"] == "1450.75"
    expense = expenses["items"][0]
    assert expense["category"]["name"] == "Internet/Wi-Fi" and expense["payment_method"] == "mobile_wallet"
    assert expense["description"] == "Worldlink (bill)"
    assert user.get(f"/api/bills/{bill['id']}/payments").json()[0]["expense_id"] == expense["id"]


def test_one_time_bill_is_paid_once(user):
    bill = create_bill(user, "Laptop repair", "3000", "other", frequency="one_time").json()
    paid = user.post(f"/api/bills/{bill['id']}/pay", json={"paid_on": TODAY.isoformat()}).json()
    assert paid["status"] == "paid" and paid["due_date"] == bill["due_date"]
    again = user.post(f"/api/bills/{bill['id']}/pay", json={"paid_on": TODAY.isoformat()})
    assert again.status_code == 409


def test_paid_this_month_total(user):
    bill = create_bill(user, amount="100.10").json()
    user.post(f"/api/bills/{bill['id']}/pay", json={"paid_on": TODAY.isoformat()})
    user.post(f"/api/bills/{bill['id']}/pay", json={"paid_on": TODAY.isoformat(), "amount": "0.20"})
    assert user.get("/api/bills").json()["paid_this_month_total"] == "100.30"


def test_bills_are_private(user):
    bill = create_bill(user).json()
    other = other_user()
    assert other.get("/api/bills").json()["items"] == []
    assert other.post(f"/api/bills/{bill['id']}/pay", json={"paid_on": TODAY.isoformat()}).status_code == 404
    assert other.get(f"/api/bills/{bill['id']}/payments").status_code == 404
    assert other.delete(f"/api/bills/{bill['id']}").status_code == 404


# --- Savings ---------------------------------------------------------------------------------------------


def create_goal(client, name="Emergency fund", target="100000.00", current="0", target_date=None, **extra):
    payload = {"name": name, "target_amount": target, "current_amount": current, **extra}
    if target_date:
        payload["target_date"] = target_date.isoformat()
    return client.post("/api/savings-goals", json=payload)


def test_goal_crud_and_progress(user):
    created = create_goal(user, current="25000.50", description="Six months of expenses")
    assert created.status_code == 201
    goal = created.json()
    assert goal["progress_percent"] == "25.0" and goal["remaining_amount"] == "74999.50"
    assert goal["completed"] is False and goal["monthly_needed"] is None

    edited = user.put(
        f"/api/savings-goals/{goal['id']}",
        json={"name": "Emergency", "target_amount": "50000", "current_amount": "60000"},
    ).json()
    assert edited["completed"] is True and edited["remaining_amount"] == "0.00" and edited["progress_percent"] == "120.0"

    history = user.get(f"/api/savings-goals/{goal['id']}/contributions").json()
    assert sorted(c["amount"] for c in history) == ["25000.50", "34999.50"]  # start + adjustment

    assert user.delete(f"/api/savings-goals/{goal['id']}").status_code == 204
    assert user.get(f"/api/savings-goals/{goal['id']}").status_code == 404


def test_deposits_withdrawals_and_limits(user):
    goal = create_goal(user, target="1000").json()
    after_deposit = user.post(
        f"/api/savings-goals/{goal['id']}/contributions",
        json={"kind": "deposit", "amount": "0.10", "date": TODAY.isoformat(), "note": "Coins"},
    ).json()
    after_deposit = user.post(
        f"/api/savings-goals/{goal['id']}/contributions",
        json={"kind": "deposit", "amount": "0.20", "date": TODAY.isoformat()},
    ).json()
    assert after_deposit["current_amount"] == "0.30"

    too_much = user.post(
        f"/api/savings-goals/{goal['id']}/contributions",
        json={"kind": "withdrawal", "amount": "0.31", "date": TODAY.isoformat()},
    )
    assert too_much.status_code == 422 and "withdraw more" in too_much.json()["detail"]

    after = user.post(
        f"/api/savings-goals/{goal['id']}/contributions",
        json={"kind": "withdrawal", "amount": "0.30", "date": TODAY.isoformat()},
    ).json()
    assert after["current_amount"] == "0.00"
    amounts = [c["amount"] for c in user.get(f"/api/savings-goals/{goal['id']}/contributions").json()]
    assert sorted(amounts) == ["-0.30", "0.10", "0.20"]


def test_monthly_needed_to_reach_target(user):
    target_date = date(TODAY.year + 1, TODAY.month, min(TODAY.day, 28))
    goal = create_goal(user, target="12000", current="0", target_date=target_date).json()
    months = months_left(TODAY, target_date)
    expected = (Decimal("12000") / months).quantize(Decimal("0.01"), rounding="ROUND_UP")
    assert goal["monthly_needed"] == str(expected)
    past = create_goal(user, "Old goal", "100", target_date=TODAY - timedelta(days=1)).json()
    assert past["monthly_needed"] is None


def test_savings_validation_and_privacy(user):
    assert create_goal(user, target="0").status_code == 422
    assert create_goal(user, current="-1").status_code == 422
    assert create_goal(user, name="").status_code == 422
    goal = create_goal(user).json()
    other = other_user()
    assert other.get("/api/savings-goals").json()["goals"] == []
    deposit = {"kind": "deposit", "amount": "5", "date": TODAY.isoformat()}
    assert other.post(f"/api/savings-goals/{goal['id']}/contributions", json=deposit).status_code == 404


def test_savings_overview_totals(user):
    create_goal(user, "A", "1000", "250")
    create_goal(user, "B", "3000", "750.50")
    overview = user.get("/api/savings-goals").json()
    assert overview["total_saved"] == "1000.50" and overview["total_target"] == "4000.00"
    assert overview["progress_percent"] == "25.0"


# --- Dashboard integration ------------------------------------------------------------------------------


def test_dashboard_uses_budgets_bills_and_savings(user):
    add_expense(user, "700.00", category="Food")
    create_budget(user, "Food", "1000")
    create_budget(user, "Rent", "12000")
    create_goal(user, "Trip to Pokhara", "50000", "8000.25")
    create_bill(user, "Electricity", "1850.50", "electricity", due=TODAY - timedelta(days=2))
    create_bill(user, "Wi-Fi", "1500.00", "wifi", due=TODAY + timedelta(days=3))
    create_bill(user, "Insurance", "20000.00", "insurance", due=TODAY + timedelta(days=120), frequency="yearly")

    body = user.get("/api/dashboard/summary").json()
    finance = body["finance"]
    assert finance["budget_remaining"] == {"amount": "12300.00", "currency": "NPR"}  # 13000 - 700
    assert finance["savings"] == {"amount": "8000.25", "currency": "NPR"}
    assert finance["not_configured"] == []

    bills = body["bills"]
    assert bills["available"] is True
    assert [b["name"] for b in bills["overdue"]] == ["Electricity"]
    assert [b["name"] for b in bills["upcoming"]] == ["Wi-Fi"]  # insurance isn't due within 30 days
    assert bills["upcoming"][0]["amount"] == {"amount": "1500.00", "currency": "NPR"}

    savings = body["charts"]["savings"]
    assert len(savings) == 6 and savings[-1] == {"month": THIS_MONTH, "income": None, "expenses": None, "savings": "8000.25"}


def test_savings_chart_is_cumulative_by_month(user):
    goal = create_goal(user, target="100000").json()
    contribute = lambda kind, amount, on: user.post(  # noqa: E731
        f"/api/savings-goals/{goal['id']}/contributions", json={"kind": kind, "amount": amount, "date": on.isoformat()}
    )
    contribute("deposit", "5000", month_bounds(shift_month(THIS_MONTH, -2))[0])
    contribute("deposit", "3000", month_bounds(LAST_MONTH)[0])
    contribute("withdrawal", "1000", TODAY)
    series = {p["month"]: p["savings"] for p in user.get("/api/dashboard/summary").json()["charts"]["savings"]}
    assert series[shift_month(THIS_MONTH, -3)] == "0.00"
    assert series[shift_month(THIS_MONTH, -2)] == "5000.00"
    assert series[LAST_MONTH] == "8000.00"
    assert series[THIS_MONTH] == "7000.00"
