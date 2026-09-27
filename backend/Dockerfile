# LifeVault API.
#   Production (default target):  docker build -t lifevault-api ./backend
#   Development (with test tools): docker build --target dev ./backend
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

# --- Development: adds pytest etc.; docker-compose.yml mounts the source and uses --reload.
FROM base AS dev
COPY requirements-dev.txt ./
RUN pip install -r requirements-dev.txt
COPY . .
RUN useradd --create-home --uid 1000 appuser && chown -R appuser /app
USER appuser
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]

# --- Production: only runtime dependencies, no tests, unprivileged user.
FROM base AS prod
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
# Private storage for documents and profile pictures (mounted as a volume in production).
RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /app/var/documents \
    && chown -R appuser /app/var
USER appuser
ENV ENVIRONMENT=production \
    DOCUMENT_STORAGE_DIR=/app/var/documents
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"
# One worker: the rate limiter keeps its state in process memory (see SECURITY.md).
# --proxy-headers lets uvicorn see the scheme set by the reverse proxy.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]
