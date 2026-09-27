from datetime import UTC, date, datetime, time, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.models import CalendarEvent, Reminder
from app.services import calendar as calendar_service
from app.services.dashboard import current_period
from tests.conftest import make_client, requires_db
from tests.test_auth import register

KTM = ZoneInfo("Asia/Kathmandu")
TODAY = current_period().today

pytestmark = requires_db


@pytest.fixture
def user(client):
    register(client)
    return client


def other_user():
    other = make_client()
    register(other, username="other", email="other@example.com")
    return other


def day(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


def create_event(client, title="Dentist appointment", start=None, **extra):
    return client.post("/api/calendar/events", json={"title": title, "start_date": start or day(1), **extra})


def feed(client, start=None, end=None, **params):
    response = client.get("/api/calendar", params={"start": start or day(-40), "end": end or day(40), **params})
    assert response.status_code == 200, response.text
    return response.json()


def count(model) -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(model))


# --- Pure recurrence logic -----------------------------------------------------------------------------------------


def fake_event(start, end=None, recurrence=None, **kw):
    return SimpleNamespace(
        start_date=start, end_date=end or start, recurrence=recurrence, anchor_day=start.day,
        start_time=kw.get("start_time"), reminder_minutes=kw.get("reminder_minutes"),
    )


def test_monthly_events_keep_their_day_after_short_months():
    start = date(2026, 1, 31)
    got = [calendar_service.nth_occurrence(start, "monthly", 31, n) for n in range(4)]
    assert got == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]
    assert calendar_service.nth_occurrence(date(2024, 2, 29), "yearly", 29, 1) == date(2025, 2, 28)
    assert calendar_service.nth_occurrence(date(2024, 2, 29), "yearly", 29, 4) == date(2028, 2, 29)


def test_occurrences_in_range_skip_ahead_and_include_overlapping_multi_day_events():
    weekly = fake_event(date(2020, 1, 6), recurrence="weekly")  # a Monday, years ago
    got = list(calendar_service.occurrence_dates(weekly, date(2026, 9, 1), date(2026, 9, 30)))
    assert got == [date(2026, 9, 7), date(2026, 9, 14), date(2026, 9, 21), date(2026, 9, 28)]
    trip = fake_event(date(2026, 8, 30), date(2026, 9, 2))
    assert list(calendar_service.occurrence_dates(trip, date(2026, 9, 1), date(2026, 9, 30))) == [date(2026, 8, 30)]
    assert list(calendar_service.occurrence_dates(trip, date(2026, 9, 3), date(2026, 9, 30))) == []
    yearly_trip = fake_event(date(2025, 12, 30), date(2026, 1, 2), recurrence="yearly")
    got = list(calendar_service.occurrence_dates(yearly_trip, date(2027, 1, 1), date(2027, 1, 31)))
    assert got == [date(2026, 12, 30)]


def test_next_reminder_time_counts_back_from_the_start():
    now = datetime(2026, 9, 27, 10, 0, tzinfo=KTM)
    meeting = fake_event(date(2026, 9, 28), start_time=time(14, 0), reminder_minutes=30)
    assert calendar_service.next_reminder_time(meeting, now) == datetime(2026, 9, 28, 13, 30, tzinfo=KTM)
    all_day = fake_event(date(2026, 9, 28), reminder_minutes=1440)  # all-day: counts from 09:00
    assert calendar_service.next_reminder_time(all_day, now) is None  # 09:00 today already passed
    past = fake_event(date(2026, 9, 1), start_time=time(9, 0), reminder_minutes=0)
    assert calendar_service.next_reminder_time(past, now) is None
    daily = fake_event(date(2026, 1, 1), recurrence="daily", start_time=time(9, 30), reminder_minutes=10)
    assert calendar_service.next_reminder_time(daily, now) == datetime(2026, 9, 28, 9, 20, tzinfo=KTM)
    assert calendar_service.next_reminder_time(fake_event(date(2026, 9, 28)), now) is None  # no reminder set


# --- Access control and validation ---------------------------------------------------------------------------------


def test_calendar_requires_login(client):
    assert client.get("/api/calendar", params={"start": day(0), "end": day(1)}).status_code == 401
    assert create_event(client).status_code == 401


def test_event_crud(user):
    created = create_event(
        user, "Dentist", start=day(3), start_time="10:30", end_time="11:15", location="Kathmandu Dental",
        event_type="appointment", category="health", description="Bring the X-ray",
    )
    assert created.status_code == 201, created.text
    event = created.json()
    assert event["all_day"] is False and event["end_date"] == day(3) and event["start_time"] == "10:30:00"
    assert user.get(f"/api/calendar/events/{event['id']}").json()["location"] == "Kathmandu Dental"

    updated = user.put(
        f"/api/calendar/events/{event['id']}",
        json={"title": "Dentist (moved)", "start_date": day(4), "category": "health", "event_type": "appointment"},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Dentist (moved)" and updated.json()["all_day"] is True
    assert updated.json()["location"] is None  # PUT replaces the event

    assert user.delete(f"/api/calendar/events/{event['id']}").status_code == 204
    assert user.get(f"/api/calendar/events/{event['id']}").status_code == 404
    assert user.delete(f"/api/calendar/events/{event['id']}").status_code == 404


@pytest.mark.parametrize(
    "payload",
    [
        {"title": "  "},
        {"end_date": day(0)},  # before the start (day 1)
        {"end_time": "10:00"},  # end time without start time
        {"start_time": "10:00", "end_time": "09:00"},
        {"reminder_minutes": 7},
        {"category": "gaming"},
        {"event_type": "party"},
        {"recurrence": "hourly"},
        {"start_date": "1999-12-31"},
        {"end_date": day(400)},
        {"user_id": "00000000-0000-0000-0000-000000000000"},  # extra fields are rejected
    ],
)
def test_event_validation(user, payload):
    body = {"title": "Event", "start_date": day(1), **payload}
    assert user.post("/api/calendar/events", json=body).status_code == 422


def test_overnight_event_may_end_earlier_in_the_day(user):
    event = create_event(user, "Night bus", start=day(1), end_date=day(2), start_time="21:00", end_time="06:00")
    assert event.status_code == 201


def test_events_are_private_to_their_owner(user):
    event = create_event(user, "Private event").json()
    other = other_user()
    assert other.get(f"/api/calendar/events/{event['id']}").status_code == 404
    body = {"title": "Hijack", "start_date": day(1)}
    assert other.put(f"/api/calendar/events/{event['id']}", json=body).status_code == 404
    assert other.delete(f"/api/calendar/events/{event['id']}").status_code == 404
    assert feed(other)["items"] == []
    assert user.get(f"/api/calendar/events/{event['id']}").json()["title"] == "Private event"


def test_feed_range_validation(user):
    assert user.get("/api/calendar", params={"start": day(5), "end": day(1)}).status_code == 422
    assert user.get("/api/calendar", params={"start": day(0), "end": day(400)}).status_code == 422
    assert user.get("/api/calendar", params={"start": day(0), "end": day(1), "sources": "event,nope"}).status_code == 422
    assert user.get("/api/calendar", params={"start": day(0), "end": day(1), "category": "nope"}).status_code == 422


# --- The combined feed -------------------------------------------------------------------------------------------------


def seed_everything(client):
    create_event(client, "Team meeting", start=day(2), start_time="09:00", category="work", event_type="appointment")
    create_event(client, "Visa deadline", start=day(5), category="travel", event_type="deadline")
    client.post("/api/tasks", json={"title": "Submit report", "due_date": day(1), "due_time": "17:00", "category": "Work"})
    client.post("/api/tasks", json={"title": "Old errand", "due_date": day(-2)})
    client.post("/api/tasks", json={"title": "Dropped task", "due_date": day(3), "status": "cancelled"})
    client.post("/api/tasks", json={"title": "Undated task"})
    remind_at = datetime.combine(TODAY + timedelta(days=3), time(8, 0), tzinfo=KTM).isoformat()
    client.post("/api/reminders", json={"title": "Call mom", "remind_at": remind_at})
    client.post("/api/bills", json={"name": "Wi-Fi", "amount": "1500", "category": "wifi", "due_date": day(4), "frequency": "one_time"})
    client.post("/api/savings-goals", json={"name": "Laptop fund", "target_amount": "90000", "target_date": day(20)})


def test_feed_combines_every_module_without_copying_records(user):
    seed_everything(user)
    data = feed(user)
    by_title = {i["title"]: i for i in data["items"]}
    assert set(by_title) == {"Team meeting", "Visa deadline", "Submit report", "Old errand", "Call mom", "Wi-Fi", "Laptop fund"}
    assert data["today"] == TODAY.isoformat()
    assert data["counts"] == {"event": 2, "task": 2, "reminder": 1, "bill": 1, "goal": 1}

    assert by_title["Submit report"]["source"] == "task" and by_title["Submit report"]["start_time"] == "17:00:00"
    assert by_title["Old errand"]["is_overdue"] is True
    assert by_title["Call mom"]["start_time"] == "08:00:00" and by_title["Call mom"]["all_day"] is False
    assert by_title["Wi-Fi"]["amount"] == "1500.00" and by_title["Wi-Fi"]["status"] == "pending"
    assert by_title["Laptop fund"]["kind"] == "deadline" and by_title["Laptop fund"]["status"] == "open"
    assert by_title["Visa deadline"]["kind"] == "deadline" and by_title["Visa deadline"]["category"] == "travel"

    # Only the two events are stored by the calendar; nothing was copied.
    assert count(CalendarEvent) == 2
    assert count(Reminder) == 1

    # Sorted by date, all-day items before timed ones on the same day.
    keys = [(i["date"], not i["all_day"], i["start_time"] or "") for i in data["items"]]
    assert keys == sorted(keys)


def test_feed_reflects_changes_in_other_modules_immediately(user):
    task = user.post("/api/tasks", json={"title": "Renew licence", "due_date": day(2)}).json()
    assert feed(user)["items"][0]["is_done"] is False
    user.patch(f"/api/tasks/{task['id']}/status", json={"status": "completed"})
    item = feed(user)["items"][0]
    assert item["is_done"] is True and item["status"] == "completed"
    user.delete(f"/api/tasks/{task['id']}")
    assert feed(user)["items"] == []


def test_feed_filters(user):
    seed_everything(user)
    assert {i["source"] for i in feed(user, sources="task,bill")["items"]} == {"task", "bill"}
    assert [i["title"] for i in feed(user, sources="event", category="work")["items"]] == ["Team meeting"]
    # The category filter narrows events only; other sources still show.
    assert "Wi-Fi" in [i["title"] for i in feed(user, category="work")["items"]]
    assert "Visa deadline" not in [i["title"] for i in feed(user, category="work")["items"]]
    assert [i["title"] for i in feed(user, search="REPORT")["items"]] == ["Submit report"]
    assert [i["title"] for i in feed(user, search="travel")["items"]] == ["Visa deadline"]  # matches category
    assert feed(user, search="no such thing")["items"] == []
    narrow = feed(user, start=day(2), end=day(2))
    assert [i["title"] for i in narrow["items"]] == ["Team meeting"]


def test_recurring_event_is_projected_not_stored(user):
    create_event(user, "Yoga", start=day(-14), recurrence="weekly", start_time="06:30")
    items = [i for i in feed(user, start=day(0), end=day(27))["items"] if i["title"] == "Yoga"]
    assert len(items) == 4
    assert all(i["is_projected"] for i in items)
    assert items[0]["date"] == day(0)
    assert len({i["key"] for i in items}) == 4
    assert count(CalendarEvent) == 1


def test_multi_day_event_shows_when_range_starts_mid_event(user):
    create_event(user, "Pokhara trip", start=day(-2), end_date=day(2), category="travel")
    items = feed(user, start=day(0), end=day(0))["items"]
    assert [(i["title"], i["date"], i["end_date"]) for i in items] == [("Pokhara trip", day(-2), day(2))]


def test_recurring_bills_show_paid_current_and_projected_occurrences(user):
    bill = user.post(
        "/api/bills", json={"name": "Room rent", "amount": "12000", "category": "rent", "due_date": day(-3), "frequency": "weekly"}
    ).json()
    user.post(f"/api/bills/{bill['id']}/pay", json={"paid_on": day(-3)})  # moves due date to day 4
    rent = [i for i in feed(user, start=day(-7), end=day(18))["items"] if i["source"] == "bill"]
    assert [(i["date"], i["status"], i["is_projected"]) for i in rent] == [
        (day(-3), "paid", False),
        (day(4), "pending", False),
        (day(11), "upcoming", True),
        (day(18), "upcoming", True),
    ]
    assert rent[0]["is_done"] is True


def test_recurring_reminders_are_projected(user):
    remind_at = datetime.combine(TODAY + timedelta(days=1), time(7, 0), tzinfo=KTM).isoformat()
    user.post("/api/reminders", json={"title": "Water plants", "remind_at": remind_at, "repeat": "daily"})
    items = feed(user, start=day(0), end=day(4))["items"]
    assert [i["date"] for i in items] == [day(1), day(2), day(3), day(4)]
    assert [i["is_projected"] for i in items] == [False, True, True, True]
    assert count(Reminder) == 1


# --- Event reminders -------------------------------------------------------------------------------------------------------


def linked_reminder(client, event_id):
    reminder_id = client.get(f"/api/calendar/events/{event_id}").json()["reminder_id"]
    if reminder_id is None:
        return None
    return client.get(f"/api/reminders/{reminder_id}").json()


def test_event_reminder_uses_the_reminders_module(user):
    event = create_event(user, "Exam", start=day(3), start_time="10:00", reminder_minutes=60, location="Hall B").json()
    reminder = linked_reminder(user, event["id"])
    expected = datetime.combine(TODAY + timedelta(days=3), time(9, 0), tzinfo=KTM)
    assert datetime.fromisoformat(reminder["remind_at"]) == expected
    assert reminder["title"] == "Exam" and "1 hour before" in reminder["notes"] and "Hall B" in reminder["notes"]
    # Visible in the Reminders module, but not duplicated on the calendar.
    assert [r["title"] for r in user.get("/api/reminders").json()["items"]] == ["Exam"]
    items = feed(user)["items"]
    assert [(i["source"], i["reminder_minutes"]) for i in items] == [("event", 60)]

    # Moving the event moves its reminder; the same Reminder row is reused.
    body = {"title": "Exam", "start_date": day(5), "start_time": "08:00", "reminder_minutes": 1440}
    user.put(f"/api/calendar/events/{event['id']}", json=body)
    moved = linked_reminder(user, event["id"])
    assert moved["id"] == reminder["id"]
    assert datetime.fromisoformat(moved["remind_at"]) == datetime.combine(TODAY + timedelta(days=4), time(8, 0), tzinfo=KTM)

    # Turning the reminder off removes it.
    body.pop("reminder_minutes")
    user.put(f"/api/calendar/events/{event['id']}", json=body)
    assert user.get(f"/api/calendar/events/{event['id']}").json()["reminder_id"] is None
    assert user.get(f"/api/reminders/{reminder['id']}").status_code == 404


def test_deleting_an_event_deletes_its_reminder(user):
    event = create_event(user, "Exam", start=day(3), start_time="10:00", reminder_minutes=15).json()
    assert count(Reminder) == 1
    user.delete(f"/api/calendar/events/{event['id']}")
    assert count(Reminder) == 0


def test_past_events_get_no_reminder(user):
    event = create_event(user, "Old", start=day(-3), start_time="10:00", reminder_minutes=0).json()
    assert event["reminder_id"] is None and event["reminder_minutes"] == 0
    assert count(Reminder) == 0


def test_recurring_event_reminder_repeats(user):
    event = create_event(user, "Standup", start=day(-10), start_time="23:59", recurrence="daily", reminder_minutes=5).json()
    reminder = linked_reminder(user, event["id"])
    assert reminder["repeat"] == "daily"
    fire = datetime.fromisoformat(reminder["remind_at"]).astimezone(KTM)
    assert fire.time() == time(23, 54) and fire > datetime.now(UTC)


def test_reminder_deleted_elsewhere_is_recreated_on_next_save(user):
    event = create_event(user, "Exam", start=day(3), start_time="10:00", reminder_minutes=15).json()
    user.delete(f"/api/reminders/{event['reminder_id']}")
    assert user.get(f"/api/calendar/events/{event['id']}").json()["reminder_id"] is None
    body = {"title": "Exam", "start_date": day(3), "start_time": "10:00", "reminder_minutes": 15}
    assert user.put(f"/api/calendar/events/{event['id']}", json=body).json()["reminder_id"] is not None
    assert count(Reminder) == 1


def test_missed_reminder_repeats_are_not_projected(user):
    remind_at = datetime.combine(TODAY - timedelta(days=3), time(7, 0), tzinfo=KTM).isoformat()
    user.post("/api/reminders", json={"title": "Take medicine", "remind_at": remind_at, "repeat": "daily"})
    items = feed(user, start=day(-5), end=day(2))["items"]
    # The overdue occurrence shows as due; the missed days in between don't (completing skips them).
    assert items[0]["date"] == day(-3) and items[0]["status"] == "due" and items[0]["is_overdue"] is True
    projected = [i["date"] for i in items[1:]]
    assert all(d >= day(0) for d in projected) and day(1) in projected and day(2) in projected
