from datetime import UTC, date, datetime, time, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from app.services import reminders as reminder_service
from app.services import tasks as task_service
from app.services.dashboard import current_period
from tests.conftest import make_client, requires_db
from tests.test_auth import register

KTM = ZoneInfo("Asia/Kathmandu")
TODAY = current_period().today


@pytest.fixture
def user(client):
    register(client)
    return client


def other_user():
    other = make_client()
    register(other, username="other", email="other@example.com")
    return other


def create_task(client, title="Pay internet bill", **extra):
    return client.post("/api/tasks", json={"title": title, **extra})


def day(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


# --- Pure overdue / recurrence logic (fixed clock) ----------------------------------------------------------------


def fake_task(**kw):
    defaults = {"status": "not_started", "due_date": None, "due_time": None}
    return SimpleNamespace(**{**defaults, **kw})


def test_overdue_logic_uses_date_and_time():
    now = datetime(2026, 9, 24, 14, 30, tzinfo=KTM)
    assert task_service.is_overdue(fake_task(due_date=date(2026, 9, 23)), now)
    assert task_service.is_overdue(fake_task(due_date=date(2026, 9, 24), due_time=time(14, 0)), now)
    assert not task_service.is_overdue(fake_task(due_date=date(2026, 9, 24), due_time=time(15, 0)), now)
    assert not task_service.is_overdue(fake_task(due_date=date(2026, 9, 24)), now)  # no time: due by end of day
    assert not task_service.is_overdue(fake_task(), now)  # undated tasks are never overdue
    for closed in ("completed", "cancelled"):
        assert not task_service.is_overdue(fake_task(status=closed, due_date=date(2026, 1, 1)), now)
    assert task_service.is_overdue(fake_task(status="in_progress", due_date=date(2026, 9, 1)), now)


def test_due_soon_window():
    now = datetime(2026, 9, 24, 9, 0, tzinfo=KTM)
    assert task_service.is_due_soon(fake_task(due_date=date(2026, 9, 24)), now)
    assert task_service.is_due_soon(fake_task(due_date=date(2026, 9, 27)), now)  # 3 days
    assert not task_service.is_due_soon(fake_task(due_date=date(2026, 9, 28)), now)
    assert not task_service.is_due_soon(fake_task(due_date=date(2026, 9, 23)), now)  # overdue, not "soon"


def test_next_task_due_date():
    today = date(2026, 9, 24)
    assert task_service.next_due_date(date(2026, 9, 24), "daily", 24, today) == date(2026, 9, 25)
    assert task_service.next_due_date(date(2026, 9, 20), "daily", 20, today) == date(2026, 9, 24)  # missed days skipped
    assert task_service.next_due_date(date(2026, 9, 24), "weekly", 24, today) == date(2026, 10, 1)
    assert task_service.next_due_date(date(2026, 1, 31), "monthly", 31, date(2026, 1, 31)) == date(2026, 2, 28)
    assert task_service.next_due_date(date(2026, 2, 28), "monthly", 31, date(2026, 2, 28)) == date(2026, 3, 31)
    assert task_service.next_due_date(date(2028, 2, 29), "yearly", 29, date(2028, 2, 29)) == date(2029, 2, 28)


def reminder_like(remind_at, repeat, anchor_day=None, count=None, unit=None):
    local = remind_at.astimezone(KTM)
    return SimpleNamespace(remind_at=remind_at, repeat=repeat, anchor_day=anchor_day or local.day, interval_count=count, interval_unit=unit)


def test_reminder_next_occurrence_on_local_wall_clock():
    nine_am = datetime(2026, 1, 31, 9, 0, tzinfo=KTM)
    now = nine_am + timedelta(minutes=1)
    nxt = reminder_service.next_occurrence(reminder_like(nine_am, "monthly"), now)
    assert nxt.astimezone(KTM) == datetime(2026, 2, 28, 9, 0, tzinfo=KTM)
    feb = reminder_like(datetime(2026, 2, 28, 9, 0, tzinfo=KTM), "monthly", anchor_day=31)
    assert reminder_service.next_occurrence(feb, now).astimezone(KTM) == datetime(2026, 3, 31, 9, 0, tzinfo=KTM)
    assert reminder_service.next_occurrence(reminder_like(nine_am, "daily"), now).astimezone(KTM) == datetime(2026, 2, 1, 9, 0, tzinfo=KTM)
    assert reminder_service.next_occurrence(reminder_like(nine_am, "weekly"), now).astimezone(KTM) == datetime(2026, 2, 7, 9, 0, tzinfo=KTM)
    assert reminder_service.next_occurrence(reminder_like(nine_am, "yearly"), now).astimezone(KTM) == datetime(2027, 1, 31, 9, 0, tzinfo=KTM)
    every_3_days = reminder_like(nine_am, "custom", count=3, unit="days")
    assert reminder_service.next_occurrence(every_3_days, now).astimezone(KTM) == datetime(2026, 2, 3, 9, 0, tzinfo=KTM)
    every_2_months = reminder_like(nine_am, "custom", count=2, unit="months")
    assert reminder_service.next_occurrence(every_2_months, now).astimezone(KTM) == datetime(2026, 3, 31, 9, 0, tzinfo=KTM)
    # Missed occurrences are skipped: completing a daily reminder 10 days late -> next future one.
    late = nine_am + timedelta(days=10, hours=1)
    assert reminder_service.next_occurrence(reminder_like(nine_am, "daily"), late).astimezone(KTM) == datetime(2026, 2, 11, 9, 0, tzinfo=KTM)


# --- Task CRUD ------------------------------------------------------------------------------------------------------


@requires_db
def test_task_crud(user):
    created = create_task(
        user,
        description="Worldlink, before the 5th",
        category="  Home ",
        priority="high",
        due_date=day(2),
        due_time="18:30",
    )
    assert created.status_code == 201
    task = created.json()
    assert task["status"] == "not_started" and task["priority"] == "high" and task["category"] == "Home"
    assert task["due_time"] == "18:30:00" and task["completed_at"] is None and task["created_at"]
    assert task["is_overdue"] is False and task["is_due_soon"] is True

    updated = user.put(f"/api/tasks/{task['id']}", json={"title": "Pay Wi-Fi", "status": "in_progress"}).json()
    assert updated["title"] == "Pay Wi-Fi" and updated["status"] == "in_progress" and updated["due_date"] is None

    done = user.patch(f"/api/tasks/{task['id']}/status", json={"status": "completed"}).json()
    assert done["status"] == "completed" and done["completed_at"] is not None
    reopened = user.patch(f"/api/tasks/{task['id']}/status", json={"status": "not_started"}).json()
    assert reopened["completed_at"] is None

    assert user.get(f"/api/tasks/{task['id']}").status_code == 200
    assert user.delete(f"/api/tasks/{task['id']}").status_code == 204
    assert user.get(f"/api/tasks/{task['id']}").status_code == 404


@requires_db
@pytest.mark.parametrize(
    ("payload", "fragment"),
    [
        ({"title": ""}, "at least 1 character"),
        ({"title": "x" * 201}, "at most 200"),
        ({"due_time": "09:00"}, "due date to use a due time"),
        ({"recurrence": "weekly"}, "need a due date"),
        ({"priority": "critical"}, "Input should be"),
        ({"status": "blocked"}, "Input should be"),
        ({"category": "c" * 51}, "at most 50"),
    ],
)
def test_task_validation(user, payload, fragment):
    response = user.post("/api/tasks", json={"title": "Task", **payload})
    assert response.status_code == 422
    assert fragment in " ".join(e["msg"] for e in response.json()["errors"])


@requires_db
def test_tasks_are_private(user):
    task = create_task(user).json()
    other = other_user()
    assert other.get("/api/tasks").json()["items"] == []
    assert other.get(f"/api/tasks/{task['id']}").status_code == 404
    assert other.patch(f"/api/tasks/{task['id']}/status", json={"status": "completed"}).status_code == 404
    assert other.delete(f"/api/tasks/{task['id']}").status_code == 404


# --- Views & filters ---------------------------------------------------------------------------------------------------


@requires_db
def test_task_views_and_counts(user):
    create_task(user, "Overdue report", due_date=day(-2), priority="urgent")
    create_task(user, "Today low", due_date=day(0), priority="low")
    create_task(user, "Today high", due_date=day(0), priority="high")
    create_task(user, "Next week", due_date=day(7))
    create_task(user, "Someday")  # undated
    done = create_task(user, "Finished", due_date=day(-1)).json()
    user.patch(f"/api/tasks/{done['id']}/status", json={"status": "completed"})
    cancelled = create_task(user, "Dropped", due_date=day(-5)).json()
    user.patch(f"/api/tasks/{cancelled['id']}/status", json={"status": "cancelled"})

    titles = lambda view: [t["title"] for t in user.get("/api/tasks", params={"view": view}).json()["items"]]  # noqa: E731
    assert titles("overdue") == ["Overdue report"]
    assert titles("today") == ["Today high", "Today low"]  # priority order within the day
    assert titles("upcoming") == ["Next week"]
    assert titles("completed") == ["Finished"]
    all_titles = titles("all")
    assert len(all_titles) == 7 and all_titles[-2:] in (["Finished", "Dropped"], ["Dropped", "Finished"])

    counts = user.get("/api/tasks").json()["counts"]
    assert counts == {"today": 2, "upcoming": 1, "overdue": 1, "completed": 1, "all": 7}


@requires_db
def test_task_filters(user):
    create_task(user, "Study for exam", category="Study", priority="high")
    create_task(user, "Buy groceries", category="Errands", priority="low", description="Milk and eggs")
    create_task(user, "Gym", category="Health", status="in_progress")
    get = lambda **p: [t["title"] for t in user.get("/api/tasks", params=p).json()["items"]]  # noqa: E731
    assert get(category="study") == ["Study for exam"]
    assert get(priority="low") == ["Buy groceries"]
    assert get(status="in_progress") == ["Gym"]
    assert get(search="eggs") == ["Buy groceries"]
    assert get(search="100%") == []
    assert user.get("/api/tasks/categories").json() == ["Errands", "Health", "Study"]
    assert user.get("/api/tasks", params={"view": "later"}).status_code == 422


# --- "You haven't worked on these tasks" ------------------------------------------------------------------------------------


@requires_db
def test_pending_tasks_use_only_stored_status(user):
    create_task(user, "Overdue untouched", due_date=day(-1))
    create_task(user, "Due soon untouched", due_date=day(2))
    create_task(user, "Untouched later", due_date=day(20))
    create_task(user, "Untouched undated")
    create_task(user, "Already started", due_date=day(-3), status="in_progress")  # excluded: status isn't Not Started
    finished = create_task(user, "Done", due_date=day(-1)).json()
    user.patch(f"/api/tasks/{finished['id']}/status", json={"status": "completed"})

    pending = user.get("/api/tasks/pending").json()
    assert pending["due_soon_days"] == 3
    assert [t["title"] for t in pending["overdue"]] == ["Overdue untouched"]
    assert [t["title"] for t in pending["due_soon"]] == ["Due soon untouched"]
    assert [t["title"] for t in pending["not_started"]] == ["Untouched later", "Untouched undated"]


# --- Recurring tasks ------------------------------------------------------------------------------------------------------------


@requires_db
def test_completing_a_recurring_task_creates_the_next_one(user):
    task = create_task(user, "Water plants", due_date=day(0), due_time="07:00", recurrence="daily", category="Home").json()
    user.patch(f"/api/tasks/{task['id']}/status", json={"status": "completed"})

    open_tasks = user.get("/api/tasks", params={"status": "not_started"}).json()["items"]
    assert len(open_tasks) == 1
    nxt = open_tasks[0]
    assert nxt["title"] == "Water plants" and nxt["due_date"] == day(1) and nxt["due_time"] == "07:00:00"
    assert nxt["recurrence"] == "daily" and nxt["previous_task_id"] == task["id"] and nxt["category"] == "Home"

    # Reopening and completing again doesn't create a duplicate.
    user.patch(f"/api/tasks/{task['id']}/status", json={"status": "in_progress"})
    user.patch(f"/api/tasks/{task['id']}/status", json={"status": "completed"})
    assert len(user.get("/api/tasks", params={"status": "not_started"}).json()["items"]) == 1


@requires_db
def test_non_recurring_and_cancelled_tasks_do_not_repeat(user):
    once = create_task(user, "One-off", due_date=day(0)).json()
    user.patch(f"/api/tasks/{once['id']}/status", json={"status": "completed"})
    weekly = create_task(user, "Weekly review", due_date=day(0), recurrence="weekly").json()
    user.patch(f"/api/tasks/{weekly['id']}/status", json={"status": "cancelled"})
    assert user.get("/api/tasks", params={"status": "not_started"}).json()["items"] == []


# --- Reminders -------------------------------------------------------------------------------------------------------------------


def iso(dt: datetime) -> str:
    return dt.isoformat()


def create_reminder(client, title="Call landlord", at=None, **extra):
    at = at or (datetime.now(UTC) + timedelta(hours=2))
    return client.post("/api/reminders", json={"title": title, "remind_at": iso(at), **extra})


@requires_db
def test_reminder_crud(user):
    at = datetime.now(KTM).replace(microsecond=0) + timedelta(days=1)
    created = create_reminder(user, at=at, notes="About the deposit")
    assert created.status_code == 201
    reminder = created.json()
    assert reminder["repeat"] == "none" and reminder["status"] == "active"
    assert datetime.fromisoformat(reminder["remind_at"]) == at
    assert reminder["is_due"] is False and reminder["is_snoozed"] is False

    edited = user.put(
        f"/api/reminders/{reminder['id']}",
        json={"title": "Pay rent", "remind_at": iso(at), "repeat": "custom", "interval_count": 2, "interval_unit": "weeks"},
    ).json()
    assert edited["title"] == "Pay rent" and edited["interval_count"] == 2 and edited["interval_unit"] == "weeks"
    assert edited["notes"] is None

    assert user.get(f"/api/reminders/{reminder['id']}").status_code == 200
    assert user.delete(f"/api/reminders/{reminder['id']}").status_code == 204
    assert user.get(f"/api/reminders/{reminder['id']}").status_code == 404


@requires_db
@pytest.mark.parametrize(
    ("payload", "fragment"),
    [
        ({"remind_at": "2026-09-25T09:00:00"}, "timezone"),  # naive datetimes are rejected
        ({"repeat": "custom"}, "every N"),
        ({"repeat": "custom", "interval_count": 0, "interval_unit": "days"}, "greater than or equal to 1"),
        ({"repeat": "hourly"}, "Input should be"),
        ({"title": ""}, "at least 1 character"),
    ],
)
def test_reminder_validation(user, payload, fragment):
    body = {"title": "R", "remind_at": iso(datetime.now(UTC) + timedelta(hours=1)), **payload}
    response = user.post("/api/reminders", json=body)
    assert response.status_code == 422
    assert fragment in " ".join(e["msg"] for e in response.json()["errors"])


@requires_db
def test_non_custom_repeat_clears_interval(user):
    reminder = create_reminder(user, repeat="daily", interval_count=3, interval_unit="days").json()
    assert reminder["interval_count"] is None and reminder["interval_unit"] is None


@requires_db
def test_snooze_complete_and_views(user):
    due = create_reminder(user, "Take medicine", at=datetime.now(UTC) - timedelta(minutes=5)).json()
    later = create_reminder(user, "Dentist", at=datetime.now(UTC) + timedelta(days=3)).json()
    views = lambda v: [r["title"] for r in user.get("/api/reminders", params={"view": v}).json()["items"]]  # noqa: E731
    assert views("due") == ["Take medicine"] and views("upcoming") == ["Dentist"]

    snoozed = user.post(f"/api/reminders/{due['id']}/snooze", json={"minutes": 30}).json()
    assert snoozed["is_snoozed"] is True and snoozed["is_due"] is False
    assert snoozed["effective_at"] == snoozed["snoozed_until"]
    assert views("due") == [] and views("upcoming") == ["Take medicine", "Dentist"]

    past = user.post(f"/api/reminders/{due['id']}/snooze", json={"until": iso(datetime.now(UTC) - timedelta(minutes=1))})
    assert past.status_code == 422
    assert user.post(f"/api/reminders/{due['id']}/snooze", json={}).status_code == 422

    completed = user.post(f"/api/reminders/{later['id']}/complete").json()
    assert completed["status"] == "completed" and completed["completed_at"] is not None
    assert views("completed") == ["Dentist"]
    assert user.post(f"/api/reminders/{later['id']}/complete").status_code == 409
    assert user.post(f"/api/reminders/{later['id']}/snooze", json={"minutes": 10}).status_code == 409

    counts = user.get("/api/reminders").json()["counts"]
    assert counts == {"due": 0, "upcoming": 1, "completed": 1, "all": 2}


@requires_db
def test_completing_recurring_reminder_moves_to_next_occurrence(user):
    first = datetime.now(KTM).replace(second=0, microsecond=0) - timedelta(hours=1)
    reminder = create_reminder(user, "Weekly review", at=first, repeat="weekly").json()
    assert reminder["is_due"] is True
    done = user.post(f"/api/reminders/{reminder['id']}/complete").json()
    assert done["status"] == "active" and done["is_due"] is False and done["last_completed_at"] is not None
    assert datetime.fromisoformat(done["remind_at"]) == first + timedelta(weeks=1)


@requires_db
def test_editing_reactivates_and_clears_snooze(user):
    reminder = create_reminder(user, at=datetime.now(UTC) + timedelta(hours=1)).json()
    user.post(f"/api/reminders/{reminder['id']}/snooze", json={"minutes": 120})
    user.post(f"/api/reminders/{reminder['id']}/complete")
    reopened = user.put(
        f"/api/reminders/{reminder['id']}", json={"title": "Again", "remind_at": iso(datetime.now(UTC) + timedelta(days=1))}
    ).json()
    assert reopened["status"] == "active" and reopened["snoozed_until"] is None and reopened["completed_at"] is None


@requires_db
def test_reminders_are_private(user):
    reminder = create_reminder(user).json()
    other = other_user()
    assert other.get("/api/reminders").json()["items"] == []
    assert other.post(f"/api/reminders/{reminder['id']}/complete").status_code == 404
    assert other.post(f"/api/reminders/{reminder['id']}/snooze", json={"minutes": 5}).status_code == 404
    assert other.delete(f"/api/reminders/{reminder['id']}").status_code == 404


# --- Dashboard integration -------------------------------------------------------------------------------------------------------


@requires_db
def test_dashboard_tasks_and_reminders(user):
    create_task(user, "Overdue", due_date=day(-1))
    create_task(user, "Today", due_date=day(0), priority="urgent")
    create_task(user, "Not started later", due_date=day(10))
    create_task(user, "Working on it", due_date=day(10), status="in_progress")
    create_reminder(user, "Due now", at=datetime.now(UTC) - timedelta(minutes=1))
    create_reminder(user, "Tomorrow", at=datetime.now(UTC) + timedelta(days=1))
    done = create_reminder(user, "Done", at=datetime.now(UTC) + timedelta(days=2)).json()
    user.post(f"/api/reminders/{done['id']}/complete")

    body = user.get("/api/dashboard/summary").json()
    tasks = body["tasks"]
    assert tasks["available"] is True
    assert [t["title"] for t in tasks["overdue"]] == ["Overdue"]
    assert [t["title"] for t in tasks["today"]] == ["Today"]
    # Pending = Not Started and not overdue; "Working on it" is in progress, so excluded.
    assert [t["title"] for t in tasks["pending"]] == ["Today", "Not started later"]
    assert tasks["counts"] == {"today": 1, "pending": 2, "overdue": 1}

    reminders = body["reminders"]
    assert reminders["available"] is True and reminders["due_count"] == 1
    assert [(r["title"], r["is_due"]) for r in reminders["upcoming"]] == [("Due now", True), ("Tomorrow", False)]
