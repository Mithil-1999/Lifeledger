# LifeVault in ONE container: the web app and the API together.
# Used by hosts that run a single Docker service (e.g. Render). For your own server,
# docker-compose.prod.yml (separate nginx + API) is still the recommended setup.

# --- 1. Build the web app ---
FROM node:24-alpine AS web
WORKDIR /web/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- 2. API + built web app ---
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
COPY --from=web /web/frontend/dist ./static

RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /app/var/documents \
    && chown -R appuser /app/var
USER appuser

ENV ENVIRONMENT=production \
    STATIC_DIR=/app/static \
    DOCUMENT_STORAGE_DIR=/app/var/documents \
    PORT=8000
EXPOSE 8000

# Apply database migrations, then start. Render (and similar hosts) provide $PORT.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips '*' --no-server-header"]
