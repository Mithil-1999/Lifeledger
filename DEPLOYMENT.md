# Deploying LifeVault

This guide runs LifeVault in production with Docker Compose on one Linux server. Only one
app port is exposed, on `127.0.0.1`, behind a TLS reverse proxy.

```text
Internet ──HTTPS──▶ reverse proxy (Caddy / nginx / Traefik)  ──HTTP──▶ web (nginx :8080)
                                                                          ├── static SPA
                                                                          └── /api ──▶ backend (uvicorn :8000) ──▶ db (PostgreSQL 17)
                                                                                         └── documents volume
```

> Security review and limitations: [SECURITY.md](SECURITY.md).

## 1. Requirements

- A Linux server with Docker Engine 24+ and the Compose plugin, 1 CPU, 1 GB RAM, and disk
  for your documents.
- A domain name pointing at the server, and a TLS reverse proxy (the example below uses Caddy).
- A place to keep backups **off the server**, plus a password manager for the secrets.

## 2. Configure

```bash
git clone https://github.com/Mithil-1999/Lifeledger.git lifevault && cd lifevault
cp .env.example .env
chmod 600 .env
```

Generate the secrets and put them in `.env`:

```bash
python3 -c "import secrets; print('APP_SECRET_KEY=' + secrets.token_urlsafe(48))"
python3 -c "import secrets,base64; print('VAULT_MASTER_KEY=' + base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
python3 -c "import secrets; print('POSTGRES_PASSWORD=' + secrets.token_urlsafe(32))"
```

Then set these in `.env`:

| Setting | Production value |
| --- | --- |
| `ENVIRONMENT` | `production` |
| `DEBUG` | `false` |
| `APP_SECRET_KEY`, `VAULT_MASTER_KEY`, `POSTGRES_PASSWORD` | the generated values |
| `POSTGRES_USER`, `POSTGRES_DB` | e.g. `lifevault` |
| `FRONTEND_URL`, `BACKEND_URL` | `https://your-domain` |
| `COOKIE_SECURE` | `true` |
| `EMAIL_BACKEND` | `smtp` (and `SMTP_*`, `EMAIL_FROM`), or `disabled` |
| `REGISTRATION_ENABLED` | `true` for the first start only, then `false` |
| `APP_TIMEZONE` | e.g. `Asia/Kathmandu` |
| `WEB_HOST_PORT` | `8080` (default) |

`DATABASE_URL` and `TRUST_PROXY_HEADERS` are set by `docker-compose.prod.yml`. The API
**refuses to start** in production with a default secret key, no vault key,
`COOKIE_SECURE=false`, `DEBUG=true` or a development email backend.

> ⚠️ **Store `VAULT_MASTER_KEY` in your password manager now.** Without it, vault entries
> can never be decrypted, even from backups. Anyone with the key *and* the database can
> decrypt them, so never keep the two together.

## 3. Start

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps        # db, backend and web healthy; migrate "exited (0)"
curl -s http://127.0.0.1:8080/api/health            # {"status":"ok",...,"database":"ok"}
```

On each start, the one-off `migrate` service runs `alembic upgrade head`. The API only starts
after the migrations succeed.

## 4. HTTPS (reverse proxy)

Example with Caddy, which obtains and renews certificates automatically. `/etc/caddy/Caddyfile`:

```text
lifevault.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8080 {
        header_up X-Forwarded-Proto {scheme}
    }
}
```

The `web` container overwrites `X-Forwarded-For` with the address it receives. With Caddy on
the same host, that's `127.0.0.1`, so every client shares one rate-limit bucket. To rate-limit
per real client, add this to the top of the `server` block in `frontend/nginx.conf` and rebuild:

```nginx
set_real_ip_from 172.16.0.0/12;   # the Docker network / your proxy's address
real_ip_header X-Forwarded-For;
```

## 5. First account

1. Open `https://your-domain/register` and create your account.
2. Set `REGISTRATION_ENABLED=false` in `.env`, then `docker compose -f docker-compose.prod.yml up -d`.
3. In **Settings → Security**, check that only your session is listed.

## 6. Database migrations

- **Automatic:** every `up` runs pending migrations first (the `migrate` service).
- **Manual:** `docker compose -f docker-compose.prod.yml run --rm migrate alembic upgrade head`
- **Current version:** `docker compose -f docker-compose.prod.yml run --rm migrate alembic current`
  (also shown under **Settings → Data → Backup information**)
- **Roll back one step:** `... run --rm migrate alembic downgrade -1`. Take a backup first:
  downgrades drop the tables and columns added by that migration.
- Migrations run from an empty database up to the latest, and back down to empty, on every
  test run, so each one is tested.

## 7. Backups

A complete backup has **three parts**:

| Part | How | Where to keep it |
| --- | --- | --- |
| PostgreSQL database | `pg_dump` (custom format) | encrypted, off-server |
| Documents volume (files + profile pictures) | tar of `/app/var/documents` | encrypted, off-server |
| `VAULT_MASTER_KEY` (+ `.env`) | copy once, and again whenever it changes | password manager, **separate** from data backups |

```bash
./scripts/backup.sh /srv/lifevault-backups     # writes lifevault-db-<time>.dump and lifevault-documents-<time>.tar.gz
```

Schedule it, e.g. daily at 02:30 with `crontab -e`:

```text
30 2 * * * cd /opt/lifevault && ./scripts/backup.sh /srv/lifevault-backups >> /var/log/lifevault-backup.log 2>&1
```

Then encrypt and copy the files off the server (for example with `restic`, `borg`, or
`age` + `rclone`), and prune old ones. Backups contain all your personal and financial data.

**Restore** (replaces the current data; the `.env` must have the same `VAULT_MASTER_KEY`):

```bash
./scripts/restore.sh backups/lifevault-db-<time>.dump backups/lifevault-documents-<time>.tar.gz
```

**Test a restore** on a spare machine every few months. A backup you haven't restored isn't
proven to work.

Users can also download their own data (JSON) from **Settings → Data**. That's a personal
copy, not a replacement for server backups: it doesn't include files or vault passwords.

## 8. Upgrading

```bash
./scripts/backup.sh /srv/lifevault-backups
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrations run automatically
docker compose -f docker-compose.prod.yml ps
```

## 9. Background jobs

Notification checks run inside the API every `NOTIFICATION_CHECK_INTERVAL_SECONDS` (default
300), protected by a PostgreSQL advisory lock. Each run is logged in the `job_runs` table.
To use cron or a systemd timer instead, set `NOTIFICATION_SCHEDULER_ENABLED=false` and schedule:

```bash
docker compose -f docker-compose.prod.yml exec -T backend python -m app.jobs.notifications
```

## 10. Monitoring and troubleshooting

- **Health:** `GET /api/health` returns 200, or 503 with `"database": "unavailable"`. The
  containers have health checks.
- **Logs:** `docker compose -f docker-compose.prod.yml logs -f backend web`. Logs never contain
  passwords, tokens or request bodies.
- **Job runs:** `docker compose -f docker-compose.prod.yml exec db psql -U lifevault -c "select name,status,started_at,users_checked,notifications_created,error from job_runs order by started_at desc limit 5"`

| Problem | Fix |
| --- | --- |
| API exits at start with a settings error | Read the message: a production setting in `.env` is unsafe or missing (section 2). |
| `migrate` failed | `docker compose -f docker-compose.prod.yml logs migrate`. Usually wrong DB credentials, or the database isn't ready yet. |
| Signed out immediately / CSRF errors | `COOKIE_SECURE=true` needs HTTPS. Make sure you use `https://`, and that `FRONTEND_URL` matches the address you open. |
| Uploads fail with 413 | The file is over 10 MB (documents) or 2 MB (profile pictures). |
| Vault shows "not configured" | `VAULT_MASTER_KEY` is missing or invalid. |

## 11. Development vs production

| | Development (`docker-compose.yml`) | Production (`docker-compose.prod.yml`) |
| --- | --- | --- |
| API image | `dev` target, source mounted, `--reload` | `prod` target, no tests or dev tools, read-only root filesystem |
| Web | Vite dev server :5173 | built bundle served by nginx :8080 (CSP, caching, `/api` proxy) |
| Database port | `127.0.0.1:5432` | not published |
| Migrations | run by the API command | separate `migrate` service |

> These production files were written and reviewed, but Docker wasn't available on the
> development machine, so the images haven't been built there. Run step 3 on a test server
> before relying on them.
