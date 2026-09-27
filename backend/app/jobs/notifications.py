"""Recurring notification checks: the background-job architecture.

Safety properties:
- **One run at a time.** A PostgreSQL advisory lock (held on its own connection) means only
  one process runs the checks at once, however many API workers, cron jobs or replicas exist.
  A run that can't get the lock is recorded as "skipped" and exits immediately.
- **Idempotent.** Notifications are keyed by event (see services/notifications.py), so a
  repeated or overlapping run can't create duplicates.
- **Isolated failures.** Each user is checked in their own transaction; one user's error is
  rolled back and counted without stopping the others.
- **Nothing sensitive is logged.** The run log stores counts and an exception class name only.

Two ways to run it:
- In the API process (default): `start_scheduler()` runs the checks every
  NOTIFICATION_CHECK_INTERVAL_SECONDS in a worker thread.
- From cron / a systemd timer (set NOTIFICATION_SCHEDULER_ENABLED=false):
      python -m app.jobs.notifications
"""

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import select, text

from app.core.config import get_settings
from app.db.session import SessionLocal, engine
from app.models import JobRun, JobStatus, User, UserStatus
from app.services import notifications as notification_service

logger = logging.getLogger("lifevault.jobs")

JOB_NAME = "notification_checks"
# Arbitrary constant identifying this job's advisory lock ("LV" + 1).
LOCK_KEY = 0x4C56_0001


def run_notification_checks(now: datetime | None = None) -> dict:
    """Run the checks for every active user once. Returns a summary (counts only)."""
    now = now or datetime.now(UTC)
    with engine.connect() as lock_conn:
        if not lock_conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}).scalar():
            with SessionLocal() as db:
                db.add(JobRun(name=JOB_NAME, status=JobStatus.SKIPPED, finished_at=datetime.now(UTC)))
                db.commit()
            return {"status": JobStatus.SKIPPED, "users_checked": 0, "notifications_created": 0, "failures": 0}
        try:
            return _run_locked(now)
        finally:
            lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
            lock_conn.commit()


def _run_locked(now: datetime) -> dict:
    with SessionLocal() as db:
        run = JobRun(name=JOB_NAME, status=JobStatus.RUNNING)
        db.add(run)
        db.commit()
        user_ids = list(db.scalars(select(User.id).where(User.status == UserStatus.ACTIVE)))
        created = failures = 0
        last_error = None
        for user_id in user_ids:
            try:
                created += notification_service.check_user(db, user_id, now)
            except Exception as exc:  # noqa: BLE001 - one user's failure must not stop the rest
                db.rollback()
                failures += 1
                last_error = type(exc).__name__
                logger.warning("Notification check failed for one user (%s).", last_error)
        try:
            notification_service.purge_old(db, now)
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            failures += 1
            last_error = type(exc).__name__
        run.status = JobStatus.FAILED if failures else JobStatus.SUCCEEDED
        run.users_checked = len(user_ids)
        run.notifications_created = created
        run.error = last_error
        run.finished_at = datetime.now(UTC)
        db.commit()
        return {"status": run.status, "users_checked": len(user_ids), "notifications_created": created, "failures": failures}


async def scheduler_loop(interval_seconds: int, initial_delay: float = 15.0) -> None:
    """Run the checks forever, in a thread so the event loop is never blocked."""
    await asyncio.sleep(initial_delay)
    while True:
        try:
            summary = await asyncio.to_thread(run_notification_checks)
            logger.info("Notification checks: %s", summary)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - keep the scheduler alive (e.g. database briefly down)
            logger.warning("Notification checks could not run (%s).", type(exc).__name__)
        await asyncio.sleep(interval_seconds)


def start_scheduler() -> asyncio.Task | None:
    settings = get_settings()
    if not settings.notification_scheduler_enabled or settings.environment == "test":
        return None
    return asyncio.create_task(scheduler_loop(settings.notification_check_interval_seconds), name=JOB_NAME)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(run_notification_checks())
