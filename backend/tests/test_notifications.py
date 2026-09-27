import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, func, select, text, update

from app.db.session import SessionLocal
from app.jobs import notifications as job
from app.models import JobRun, Notification
from app.services import notifications as service
from app.services.dashboard import current_period
from tests.conftest import make_client, requires_db
from tests.test_auth import register
from tests.test_finance import add_expense, category_id

KTM = ZoneInfo("Asia/Kathmandu")
TODAY = current_period().today


def day(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


@pytest.fixture
def user(client):
    register(client)
    return client


def user_id(client) -> uuid.UUID:
    return uuid.UUID(client.get("/api/auth/me").json()["id"])


def check(client, now: datetime | None = None) -> int:
    """Run the checks for this user (optionally at a chosen moment)."""
    with SessionLocal() as db:
        return service.check_user(db, user_id(client), now)


def notes(client, **params):
    response = client.get("/api/notifications", params={"limit": 100, **params})
    assert response.status_code == 200, response.text
    return response.json()


def types(client) -> list[str]:
    return sorted(n["type"] for n in notes(client)["items"])


# --- Pure helpers -------------------------------------------------------------------------------------------


def test_money_uses_south_asian_grouping():
    assert service.format_money(Decimal("1234567.5")) == "NPR 12,34,567.50"
    assert service.format_money(Decimal("999")) == "NPR 999.00"
    assert service.format_money(Decimal("100000")) == "NPR 1,00,000.00"
    assert service.format_money(Decimal("-500")) == "-NPR 500.00"


# --- Access -------------------------------------------------------------------------------------------------


@requires_db
def test_notifications_require_login(client):
    assert client.get("/api/notifications").status_code == 401
    assert client.get("/api/notifications/preferences").status_code == 401
    assert client.post("/api/notifications/check").status_code == 401


@requires_db
def test_notifications_are_private(user):
    user.post("/api/tasks", json={"title": "Private", "due_date": day(-2)})
    check(user)
    mine = notes(user)["items"][0]
    other = make_client()
    register(other, username="other", email="other@example.com")
    assert notes(other)["items"] == [] and notes(other)["unread_count"] == 0
    assert other.patch(f"/api/notifications/{mine['id']}", json={"read": True}).status_code == 404
    assert other.delete(f"/api/notifications/{mine['id']}").status_code == 404
    assert other.post("/api/notifications/read-all").json() == {"count": 0}
    assert notes(user)["items"][0]["is_read"] is False


# --- Tasks: overdue and upcoming ---------------------------------------------------------------------------


@requires_db
def test_overdue_and_upcoming_tasks_without_duplicates(user):
    overdue = user.post("/api/tasks", json={"title": "Submit report", "due_date": day(-2)}).json()
    user.post("/api/tasks", json={"title": "Call bank", "due_date": day(1), "due_time": "10:00"})
    user.post("/api/tasks", json={"title": "Far away", "due_date": day(5)})
    user.post("/api/tasks", json={"title": "Done already", "due_date": day(-3), "status": "completed"})
    user.post("/api/tasks", json={"title": "Dropped", "due_date": day(-3), "status": "cancelled"})
    user.post("/api/tasks", json={"title": "No date"})

    assert check(user) == 2
    items = {n["type"]: n for n in notes(user)["items"]}
    assert set(items) == {"task_overdue", "task_upcoming"}
    assert items["task_overdue"]["title"] == "Overdue task: Submit report"
    assert items["task_overdue"]["related_type"] == "task" and items["task_overdue"]["related_id"] == overdue["id"]
    assert items["task_upcoming"]["title"] == "Task due tomorrow: Call bank"
    assert items["task_upcoming"]["message"] == "Due tomorrow at 10:00."

    # Running the checks again (or many times) never duplicates.
    assert check(user) == 0 and check(user) == 0
    assert notes(user)["total"] == 2


@requires_db
def test_task_becomes_overdue_later(user):
    user.post("/api/tasks", json={"title": "Pay fee", "due_date": day(0), "due_time": "09:00"})
    before = datetime.combine(TODAY, time(8, 0), tzinfo=KTM)
    after = datetime.combine(TODAY, time(9, 30), tzinfo=KTM)
    assert check(user, before) == 1
    assert types(user) == ["task_upcoming"]
    assert check(user, after) == 1  # the due time passed: now overdue, once
    assert check(user, after + timedelta(hours=5)) == 0
    assert types(user) == ["task_overdue", "task_upcoming"]


@requires_db
def test_recurring_task_notifies_each_occurrence(user):
    task = user.post("/api/tasks", json={"title": "Water plants", "due_date": day(0), "recurrence": "daily"}).json()
    assert user.put("/api/notifications/preferences", json=_prefs(user, task_lead_days=1)).status_code == 200
    assert check(user) == 1
    user.patch(f"/api/tasks/{task['id']}/status", json={"status": "completed"})  # creates tomorrow's copy
    assert check(user) == 1
    upcoming = [n for n in notes(user)["items"] if n["type"] == "task_upcoming"]
    assert len(upcoming) == 2 and len({n["related_id"] for n in upcoming}) == 2


def _prefs(client, **changes):
    prefs = client.get("/api/notifications/preferences").json()
    prefs.pop("updated_at")
    return {**prefs, **changes}


# --- Bills ----------------------------------------------------------------------------------------------------


def add_bill(client, name, due, frequency="monthly", amount="1500.00"):
    return client.post("/api/bills", json={"name": name, "amount": amount, "category": "wifi", "due_date": due, "frequency": frequency}).json()


@requires_db
def test_overdue_and_upcoming_bills(user):
    add_bill(user, "Wi-Fi", day(-1), amount="1500.00")
    add_bill(user, "Rent", day(3), amount="120000.00")
    add_bill(user, "Later", day(10))
    assert check(user) == 2
    items = {n["type"]: n for n in notes(user)["items"]}
    assert items["bill_overdue"]["title"] == "Overdue bill: Wi-Fi"
    assert items["bill_overdue"]["message"].startswith("NPR 1,500.00 was due")
    assert items["bill_upcoming"]["message"].startswith("NPR 1,20,000.00 is due in 3 days")
    assert check(user) == 0


@requires_db
def test_paying_a_recurring_bill_notifies_the_next_cycle(user):
    bill = add_bill(user, "Milk", day(-1), frequency="weekly", amount="700.00")
    user.put("/api/notifications/preferences", json=_prefs(user, bill_lead_days=7))
    assert check(user) == 1 and types(user) == ["bill_overdue"]
    user.post(f"/api/bills/{bill['id']}/pay", json={"paid_on": day(0)})  # next due in 6 days
    assert check(user) == 1
    assert types(user) == ["bill_overdue", "bill_upcoming"]
    assert check(user) == 0


# --- Budgets --------------------------------------------------------------------------------------------------


@requires_db
def test_budget_threshold_then_over_budget(user):
    month = TODAY.strftime("%Y-%m")
    user.post("/api/budgets", json={"category_id": category_id(user, "expense", "Food"), "month": month, "amount": "1000.00", "warning_threshold": 80})
    add_expense(user, "799.99", TODAY.replace(day=1))
    assert check(user) == 0  # 79.999% is below 80%
    add_expense(user, "0.01", TODAY.replace(day=1))
    assert check(user) == 1
    n = notes(user)["items"][0]
    assert (n["type"], n["title"]) == ("budget_threshold", "Budget 80% reached: Food")
    assert "80.0% of your NPR 1,000.00 Food budget" in n["message"]
    assert check(user) == 0
    add_expense(user, "300.00", TODAY.replace(day=1))
    assert check(user) == 1
    over = notes(user)["items"][0]
    assert over["title"] == "Over budget: Food" and "NPR 100.00 over" in over["message"]
    assert check(user) == 0


# --- Savings milestones ------------------------------------------------------------------------------------------


@requires_db
def test_savings_milestones_announce_highest_once(user):
    goal = user.post("/api/savings-goals", json={"name": "Laptop", "target_amount": "1000.00", "current_amount": "0"}).json()

    def move(kind, amount):
        user.post(f"/api/savings-goals/{goal['id']}/contributions", json={"kind": kind, "amount": amount, "date": day(0)})

    assert check(user) == 0
    move("deposit", "250.00")
    assert check(user) == 1
    move("deposit", "550.00")  # 80%: straight past 50% to 75%
    assert check(user) == 1
    titles = [n["title"] for n in notes(user)["items"]]
    assert titles == ["75% of your savings goal: Laptop", "25% of your savings goal: Laptop"]
    move("withdrawal", "400.00")
    move("deposit", "400.00")  # back to 80%: already announced
    assert check(user) == 0
    move("deposit", "200.00")
    assert check(user) == 1
    assert notes(user)["items"][0]["title"] == "Savings goal reached: Laptop"


# --- Reminders -----------------------------------------------------------------------------------------------------


@requires_db
def test_due_reminders_and_recurring_occurrences(user):
    first = datetime.combine(TODAY - timedelta(days=1), time(9, 0), tzinfo=KTM)
    reminder = user.post("/api/reminders", json={"title": "Take medicine", "remind_at": first.isoformat(), "repeat": "daily", "notes": "After food"}).json()
    user.post("/api/reminders", json={"title": "Future", "remind_at": (datetime.now(UTC) + timedelta(days=3)).isoformat()})
    assert check(user) == 1
    n = notes(user)["items"][0]
    assert (n["type"], n["title"], n["message"], n["related_id"]) == ("reminder_due", "Reminder: Take medicine", "After food", reminder["id"])
    assert check(user) == 0

    user.post(f"/api/reminders/{reminder['id']}/complete")  # moves to the next future 09:00
    assert check(user) == 0  # not due yet
    later = datetime.now(UTC) + timedelta(days=2)
    assert check(user, later) == 1  # the next occurrence is a new event
    assert check(user, later) == 0


@requires_db
def test_snoozed_reminder_notifies_again_when_due(user):
    past = datetime.now(UTC) - timedelta(minutes=5)
    reminder = user.post("/api/reminders", json={"title": "Call mom", "remind_at": past.isoformat()}).json()
    assert check(user) == 1
    user.post(f"/api/reminders/{reminder['id']}/snooze", json={"minutes": 60})
    assert check(user) == 0
    assert check(user, datetime.now(UTC) + timedelta(minutes=61)) == 1


# --- Preferences ------------------------------------------------------------------------------------------------------


@requires_db
def test_preferences_defaults_update_and_effect(user):
    prefs = user.get("/api/notifications/preferences").json()
    assert {k: v for k, v in prefs.items() if k != "updated_at"} == {
        "task_overdue": True, "task_upcoming": True, "bill_overdue": True, "bill_upcoming": True, "budget_threshold": True,
        "savings_milestone": True, "reminder_due": True, "task_lead_days": 1, "bill_lead_days": 3, "browser_enabled": False,
    }
    updated = user.put("/api/notifications/preferences", json=_prefs(user, task_overdue=False, bill_lead_days=10, browser_enabled=True))
    assert updated.status_code == 200 and updated.json()["task_overdue"] is False and updated.json()["bill_lead_days"] == 10

    user.post("/api/tasks", json={"title": "Late", "due_date": day(-2)})
    add_bill(user, "Insurance", day(8))
    assert check(user) == 1
    assert types(user) == ["bill_upcoming"]  # overdue tasks are switched off; the bill is inside 10 days


@requires_db
@pytest.mark.parametrize(
    "change",
    [{"task_lead_days": 15}, {"bill_lead_days": -1}, {"task_overdue": "maybe"}, {"email_enabled": True}],
)
def test_preferences_validation(user, change):
    assert user.put("/api/notifications/preferences", json=_prefs(user, **change)).status_code == 422


# --- Read / unread / dismiss ---------------------------------------------------------------------------------------------


@requires_db
def test_read_unread_and_dismiss(user):
    user.post("/api/tasks", json={"title": "A", "due_date": day(-1)})
    user.post("/api/tasks", json={"title": "B", "due_date": day(-2)})
    add_bill(user, "C", day(-1))
    check(user)
    data = notes(user)
    assert data["total"] == 3 and data["unread_count"] == 3
    first = data["items"][0]

    read = user.patch(f"/api/notifications/{first['id']}", json={"read": True}).json()
    assert read["is_read"] is True and read["read_at"] is not None
    assert user.get("/api/notifications/unread-count").json() == {"unread_count": 2}
    assert [n["id"] for n in notes(user, status="unread")["items"]].count(first["id"]) == 0
    unread = user.patch(f"/api/notifications/{first['id']}", json={"read": False}).json()
    assert unread["is_read"] is False and unread["read_at"] is None

    assert [n["type"] for n in notes(user, type="bill_overdue")["items"]] == ["bill_overdue"]
    assert user.get("/api/notifications", params={"type": "nope"}).status_code == 422
    assert len(notes(user, limit=2)["items"]) == 2 and len(notes(user, limit=2, offset=2)["items"]) == 1

    assert user.post("/api/notifications/read-all").json() == {"count": 3}
    assert notes(user)["unread_count"] == 0

    # Dismissing hides it, and the same event never comes back.
    assert user.delete(f"/api/notifications/{first['id']}").status_code == 204
    assert notes(user)["total"] == 2
    assert check(user) == 0 and notes(user)["total"] == 2
    assert user.patch(f"/api/notifications/{first['id']}", json={"read": False}).status_code == 404
    assert user.post("/api/notifications/dismiss-read").json() == {"count": 2}
    assert notes(user)["total"] == 0 and check(user) == 0


@requires_db
def test_check_endpoint(user):
    user.post("/api/tasks", json={"title": "Late", "due_date": day(-1)})
    assert user.post("/api/notifications/check").json() == {"created": 1, "unread_count": 1}
    assert user.post("/api/notifications/check").json() == {"created": 0, "unread_count": 1}


# --- Background job -------------------------------------------------------------------------------------------------------


@requires_db
def test_job_checks_every_user_once_and_logs_the_run(user):
    user.post("/api/tasks", json={"title": "Late", "due_date": day(-1)})
    other = make_client()
    register(other, username="other", email="other@example.com")
    add_bill(other, "Rent", day(-1))

    summary = job.run_notification_checks()
    assert summary["status"] == "succeeded" and summary["users_checked"] == 2
    assert summary["notifications_created"] == 2 and summary["failures"] == 0
    assert job.run_notification_checks()["notifications_created"] == 0  # idempotent
    assert types(user) == ["task_overdue"] and types(other) == ["bill_overdue"]
    with SessionLocal() as db:
        runs = db.scalars(select(JobRun).order_by(JobRun.started_at)).all()
        assert [r.status for r in runs] == ["succeeded", "succeeded"] and runs[0].finished_at is not None


@requires_db
def test_job_skips_when_another_run_holds_the_lock(user):
    from app.core.config import get_settings

    other_engine = create_engine(get_settings().database_url)
    with other_engine.connect() as conn:
        assert conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": job.LOCK_KEY}).scalar()
        try:
            assert job.run_notification_checks()["status"] == "skipped"
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": job.LOCK_KEY})
            conn.commit()
    other_engine.dispose()
    assert job.run_notification_checks()["status"] == "succeeded"


@requires_db
def test_one_users_failure_does_not_stop_the_others(user, monkeypatch):
    other = make_client()
    register(other, username="other", email="other@example.com")
    add_bill(other, "Rent", day(-1))
    bad = user_id(user)
    real = service.check_user

    def flaky(db, uid, now=None):
        if uid == bad:
            raise RuntimeError("boom")
        return real(db, uid, now)

    monkeypatch.setattr(service, "check_user", flaky)
    summary = job.run_notification_checks()
    assert summary["status"] == "failed" and summary["failures"] == 1 and summary["notifications_created"] == 1
    with SessionLocal() as db:
        assert db.scalar(select(JobRun.error).where(JobRun.status == "failed")) == "RuntimeError"


@requires_db
def test_purge_removes_only_old_read_or_dismissed(user):
    for title in ("A", "B", "C"):
        user.post("/api/tasks", json={"title": title, "due_date": day(-1)})
    check(user)
    ids = [n["id"] for n in notes(user)["items"]]
    user.patch(f"/api/notifications/{ids[0]}", json={"read": True})
    user.delete(f"/api/notifications/{ids[1]}")
    with SessionLocal() as db:
        db.execute(update(Notification).values(created_at=datetime.now(UTC) - timedelta(days=200)))
        db.commit()
        assert service.purge_old(db) == 2
        assert db.scalar(select(func.count()).select_from(Notification)) == 1  # the unread one stays


@requires_db
def test_scheduler_is_off_in_tests():
    assert job.start_scheduler() is None


def test_type_list_matches_preferences():
    assert set(service.TYPE_FIELDS) == {"task_overdue", "task_upcoming", "bill_overdue", "bill_upcoming", "budget_threshold", "savings_milestone", "reminder_due"}
