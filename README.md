# LifeVault

A private, self-hosted personal life-management web app. It covers income, expenses, bills, rent, budgets, savings, debts, tasks, reminders, a calendar, notes, documents and an encrypted password vault, all in one dashboard.

> **Status: Phase 1 (Project Foundation).** You get the full-stack skeleton, the responsive app shell and navigation, the database wiring, and a health check. Each business module is currently a placeholder page, and its features are built in the later phases listed below.

Default currency is **NPR (Nepalese Rupee)**. The architecture leaves room for more currencies later.

---

## Technology stack

| Layer    | Technology                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui-style components (Radix UI), React Router, TanStack Query, Lucide icons |
| Backend  | Python, FastAPI, Pydantic v2 / pydantic-settings, SQLAlchemy 2.0, Alembic                            |
| Database | PostgreSQL 17 (psycopg 3 driver)                                                                    |
| Tooling  | Docker, Docker Compose, Vitest + Testing Library, pytest, ESLint                                    |

React Hook Form, Zod and Recharts are part of the planned stack. They're added in the phases that first need forms and charts.

## Project structure

```text
.
├── backend/                     FastAPI application
│   ├── app/
│   │   ├── api/                 Routers (all under /api)
│   │   │   ├── router.py
│   │   │   └── routes/health.py GET /api/health
│   │   ├── core/                Settings (env), security headers middleware
│   │   ├── db/                  Declarative Base, engine/session
│   │   ├── models/              ORM models (none yet; later phases)
│   │   └── main.py              App factory: CORS, middleware, routers
│   ├── alembic/                 Migrations (baseline revision 0001)
│   ├── tests/                   pytest suite
│   ├── alembic.ini
│   ├── Dockerfile
│   ├── requirements.txt
│   └── requirements-dev.txt
├── frontend/                    React + Vite SPA
│   ├── src/
│   │   ├── app/                 Providers and route table
│   │   ├── components/
│   │   │   ├── ui/              Reusable primitives (button, card, badge, sheet, dropdown, tooltip…)
│   │   │   ├── layout/          Sidebar, top bar, mobile drawer, bottom nav, user menu
│   │   │   ├── common/          Page header, empty state, module placeholder
│   │   │   └── theme/           Light / dark / system theme
│   │   ├── config/navigation.ts Single source of truth for nav items
│   │   ├── features/system/     API health hook, status card, status indicator
│   │   ├── lib/                 API client, query client, utils
│   │   ├── pages/               One page per module
│   │   └── test/                Vitest tests
│   └── vite.config.ts
├── docker-compose.yml           PostgreSQL + backend + frontend (development)
├── .env.example                 Environment template (copy to .env)
└── README.md
```

## Environment setup

All configuration comes from environment variables. One `.env` file at the repository root is shared by Docker Compose, the backend and the frontend dev server.

```bash
cp .env.example .env
```

Then edit `.env`:

| Variable                | Purpose                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `APP_SECRET_KEY`        | Application secret. Generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Must be 32+ chars in production. |
| `POSTGRES_USER/PASSWORD/DB` | Credentials Docker Compose uses to create the database.            |
| `POSTGRES_HOST_PORT`    | Host port the Compose DB is published on (localhost only). Change it if 5432 is taken. |
| `DATABASE_URL`          | Backend connection string when running **outside** Docker (`postgresql+psycopg://user:pass@host:port/db`). |
| `FRONTEND_URL`          | Allowed CORS origin (the SPA).                                           |
| `BACKEND_URL`           | Public URL of the API.                                                   |
| `VITE_API_PROXY_TARGET` | Where the Vite dev server proxies `/api` requests.                       |

`.env` is git-ignored. **Never commit real secrets.**

## Running with Docker (recommended)

You need Docker Desktop (or Docker Engine with the Compose plugin).

```bash
cp .env.example .env        # then edit the secrets
docker compose up --build
```

| Service  | URL                                  |
| -------- | ------------------------------------ |
| Frontend | http://localhost:5173                |
| API      | http://localhost:8000/api/health     |
| API docs | http://localhost:8000/api/docs (disabled in production) |
| Postgres | `localhost:${POSTGRES_HOST_PORT}` (bound to 127.0.0.1 only) |

When the backend container starts, it runs `alembic upgrade head` before launching the API. Source folders are bind-mounted, so code changes hot-reload.

Useful commands:

```bash
docker compose logs -f backend
docker compose exec backend pytest
docker compose exec backend alembic revision --autogenerate -m "describe change"
docker compose down            # stop
docker compose down -v         # stop AND delete the database volume
```

> On Windows, if hot reload doesn't pick up file changes inside Docker, run the frontend and backend locally instead (see below).

## Running locally (without Docker)

Requirements: Python 3.12+, Node.js 22.22+ (or 24), and a PostgreSQL 15+ server.

**1. Database.** Create a role and database that match `DATABASE_URL` in `.env`:

```sql
CREATE ROLE lifevault LOGIN PASSWORD 'your-password';
CREATE DATABASE lifevault OWNER lifevault;
```

**2. Backend**

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

**3. Frontend** (in a second terminal)

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173. The Vite dev server proxies `/api/*` to the backend, so the browser only ever talks to one origin.

## Development commands

| Where      | Command                     | What it does                          |
| ---------- | --------------------------- | ------------------------------------- |
| `backend`  | `uvicorn app.main:app --reload` | Run the API with auto-reload       |
| `backend`  | `alembic upgrade head`      | Apply migrations                      |
| `backend`  | `alembic revision --autogenerate -m "msg"` | Create a migration     |
| `frontend` | `npm run dev`               | Start the Vite dev server             |
| `frontend` | `npm run build`             | Type-check and build for production   |
| `frontend` | `npm run lint`              | ESLint                                |
| `frontend` | `npm run typecheck`         | TypeScript only                       |

## Testing

```bash
# Backend: unit tests always run; database tests run when DATABASE_URL is reachable
cd backend
pytest

# Frontend: routing, placeholder pages, API connectivity states, theme switching
cd frontend
npm test
```

Manual smoke test:

```bash
curl http://localhost:8000/api/health
# {"status":"ok","service":"LifeVault API","version":"0.1.0","environment":"development","database":"ok"}
```

If PostgreSQL is unreachable, the endpoint returns **HTTP 503** with `"database": "unavailable"`. The dashboard's *System status* card and the top-bar indicator show that state.

## API

| Method | Path          | Description                                   |
| ------ | ------------- | --------------------------------------------- |
| GET    | `/api/health` | API liveness + database connectivity check    |

## Security baseline (Phase 1)

- All configuration and secrets come from environment variables. `.env` and key/cert files are git-ignored.
- The app refuses to start in production with a weak or placeholder `APP_SECRET_KEY` or with `DEBUG=true`.
- CORS is restricted to `FRONTEND_URL` (plus optional `CORS_EXTRA_ORIGINS`).
- Every API response sets security headers: `nosniff`, `X-Frame-Options: DENY`, a strict CSP, Referrer-Policy and Permissions-Policy.
- Interactive API docs are disabled in production.
- Docker publishes ports on `127.0.0.1` only, and the backend container runs as a non-root user.
- All database access goes through SQLAlchemy with bound parameters. There's no string-built SQL.

Authentication, rate limiting, CSRF protection, vault encryption and upload hardening come in their own phases. This is a personal project, and no application is perfectly secure.

## Roadmap

| Phase | Scope                                      |
| ----- | ------------------------------------------ |
| 1     | Project foundation ✅                      |
| 2     | Authentication                             |
| 3     | Dashboard                                  |
| 4     | Income and expenses                        |
| 5     | Budget, bills, rent and savings            |
| 6     | Tasks and reminders                        |
| 7     | Secure password vault                      |
| 8     | Notes and documents                        |
| 9     | Calendar                                   |
| 10    | Reports and analytics                      |
| 11    | Notifications and automation               |
| 12    | Settings, security audit and production    |
