"""Outgoing email.

Backends (EMAIL_BACKEND):
  * dev_outbox — DEVELOPMENT ONLY. Writes each message as an .eml file to DEV_OUTBOX_DIR
    (git-ignored) so you can open the reset link locally. Links are never logged or
    returned by the API. Refused in production by settings validation.
  * smtp       — PRODUCTION. Sends through SMTP_HOST using STARTTLS by default.
                 This is where a transactional email provider (SES, Postmark, Mailgun,
                 Gmail SMTP with an app password, …) plugs in.
  * memory     — keeps messages in `sent_messages` for automated tests.
  * disabled   — drops messages.
"""

import logging
import smtplib
import ssl
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import make_msgid

from app.core.config import Settings, get_settings

logger = logging.getLogger("lifevault.email")


@dataclass(frozen=True)
class OutgoingEmail:
    to: str
    subject: str
    body: str


# Only populated by the "memory" backend (tests).
sent_messages: list[OutgoingEmail] = []


def _build_message(settings: Settings, email: OutgoingEmail) -> EmailMessage:
    message = EmailMessage()
    message["From"] = settings.email_from
    message["To"] = email.to
    message["Subject"] = email.subject
    message["Message-ID"] = make_msgid(domain="lifevault.local")
    # 8bit keeps links intact and readable in raw .eml files (quoted-printable would
    # encode "=" as "=3D" and soft-wrap long URLs).
    message.set_content(email.body, cte="8bit")
    return message


def send_email(email: OutgoingEmail) -> None:
    """Deliver an email with the configured backend. Failures are logged without the body."""
    settings = get_settings()
    try:
        if settings.email_backend == "memory":
            sent_messages.append(email)
        elif settings.email_backend == "dev_outbox":
            settings.dev_outbox_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
            path = settings.dev_outbox_dir / f"{stamp}.eml"
            path.write_bytes(bytes(_build_message(settings, email)))
            logger.info("Development email written to the dev outbox (%s)", path.name)
        elif settings.email_backend == "smtp":
            context = ssl.create_default_context()
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
                if settings.smtp_starttls:
                    smtp.starttls(context=context)
                if settings.smtp_username:
                    smtp.login(settings.smtp_username, settings.smtp_password)
                smtp.send_message(_build_message(settings, email))
        # "disabled": intentionally do nothing.
    except Exception as exc:  # Never let email failures surface to the requester.
        logger.error("Email delivery failed via %s backend: %s", settings.email_backend, type(exc).__name__)
