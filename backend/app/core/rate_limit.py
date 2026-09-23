"""Small in-memory sliding-window rate limiter for authentication endpoints.

Strategy:
  * Every sensitive auth endpoint is limited per client IP, and where it makes sense
    also per target account (identifier/email/user), so one IP cannot brute-force an
    account and many IPs cannot hammer a single account.
  * State lives in process memory, which is appropriate for this single-user,
    single-process deployment. When running multiple workers/replicas, move this to a
    shared store (e.g. Redis) behind the same `RateLimiter.hit` interface.
"""

import threading
import time
from collections import deque
from dataclasses import dataclass

from fastapi import HTTPException, Request, status

from app.core.config import get_settings


@dataclass(frozen=True)
class Limit:
    max_requests: int
    window_seconds: int


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: Limit) -> int | None:
        """Record a request. Returns seconds to wait if the limit is exceeded, else None."""
        now = time.monotonic()
        cutoff = now - limit.window_seconds
        with self._lock:
            bucket = self._hits.setdefault(key, deque())
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= limit.max_requests:
                return max(1, int(bucket[0] + limit.window_seconds - now) + 1)
            bucket.append(now)
            if len(self._hits) > 10_000:  # Opportunistic cleanup of idle keys.
                for k in [k for k, v in self._hits.items() if not v or v[-1] <= cutoff]:
                    self._hits.pop(k, None)
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()

LOGIN_PER_ACCOUNT = Limit(5, 60)
LOGIN_PER_IP = Limit(20, 15 * 60)
REGISTER_PER_IP = Limit(5, 60 * 60)
FORGOT_PER_IP = Limit(5, 60 * 60)
FORGOT_PER_EMAIL = Limit(3, 60 * 60)
RESET_PER_IP = Limit(10, 60 * 60)
CHANGE_PASSWORD_PER_USER = Limit(5, 15 * 60)


def client_ip(request: Request) -> str:
    if get_settings().trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()[:45]
    return (request.client.host if request.client else "unknown")[:45]


def enforce(scope: str, key: str, limit: Limit) -> None:
    """Raise 429 when `key` has exceeded `limit` within `scope`."""
    if not get_settings().rate_limit_enabled:
        return
    retry_after = limiter.hit(f"{scope}:{key}", limit)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Please wait a moment and try again.",
            headers={"Retry-After": str(retry_after)},
        )
