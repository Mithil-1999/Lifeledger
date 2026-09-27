# LifeVault security

This document records the Phase 12 security review, the design of the security
controls, and the limitations that remain. **LifeVault is not perfectly secure. No
application is.** It is designed as a private, single-person app, run by its owner on a
machine they trust, served over HTTPS.

To report a problem, open a private issue on the repository or contact the owner directly.
Please don't include real personal data in reports.

---

## 1. Review results (Phase 12)

| Area | What was checked | Result |
| --- | --- | --- |
| **Authentication** | Registration, login, logout, password reset, change password | ✅ Argon2id hashes, uniform timing and the same error message for unknown accounts, a password policy (length, not containing your name/username/email), and single-use reset tokens stored as HMACs. Changing or resetting the password revokes other sessions. Failed logins against an existing account are now written to its **security activity**. |
| **Authorization** | Every router, every query | ✅ All feature routers hang off `protected_router` (auth required), and every query filters on `user_id`. Another user's records return **404**, not 403. Each module has tests for this. |
| **Password hashing** | `core/security.py` | ✅ Argon2id (argon2-cffi defaults) with automatic rehash when parameters change. Hashes never leave the server, and the export excludes them. |
| **Vault encryption** | `core/vault_crypto.py`, `services/vault.py` | ✅ AES-256-GCM envelope encryption: master key in the environment only, per-user wrapped data keys, AAD binding to user, entry and field. Unlock requires re-entering the password, reveals are audited, secrets are never sent in lists, and they are **never exported**. |
| **Sessions** | `services/auth.py`, `/api/account/sessions` | ✅ Only an HMAC of the random token is stored, and the cookie is HttpOnly + SameSite=Lax (+ Secure in production). Sessions have idle and absolute expiry. **New:** list active sessions, sign out one, or sign out all others. |
| **API security** | Headers, docs, errors | ✅ API docs are off in production and errors never echo input. **Fixed:** unhandled-error logs no longer include the exception *message* (database errors embed SQL parameter values such as note text). **Fixed:** `Strict-Transport-Security` is sent when `COOKIE_SECURE=true`. |
| **Input validation** | Pydantic schemas | ✅ `extra="forbid"` on write models, length limits, enum checks, exact decimals for money, and database CHECK constraints as a second layer. |
| **SQL injection** | All SQL | ✅ SQLAlchemy ORM/Core with bound parameters everywhere. The only raw `text()` statements are constants (`SELECT 1`, advisory lock with a bound key). LIKE searches escape `%`/`_`. |
| **XSS** | React output, stored content, uploads | ✅ No `dangerouslySetInnerHTML`, `innerHTML` or `eval`. Notes are plain text. Uploaded SVG/HTML is rejected, inline images and PDFs are served under a CSP `sandbox`, and profile pictures are PNG/JPEG/WebP only, verified by their bytes and served with `sandbox`. The production web server sends a strict CSP (`script-src 'self'`). |
| **CSRF** | All state-changing requests | ✅ Double-submit token (`X-CSRF-Token` header must match the cookie) plus SameSite=Lax. The token rotates on login and logout. |
| **File uploads** | Documents, avatars | ✅ `Content-Length` limits are enforced **before** parsing (documents 10 MB, avatars 2 MB), then checked again while reading. Type comes from magic bytes on an allowlist, file names are random, storage is outside any web root, and there is a per-user quota. Deleting an account removes the files. |
| **Sensitive logging** | All loggers | ✅ Passwords are `SecretStr`, and request bodies and query strings aren't logged by the app. **Fixed:** Alembic's log setup was silently disabling the app's loggers, which also made the "secrets never reach the logs" test pass without checking anything. Loggers stay enabled now and the test is meaningful. The production nginx logs **paths without query strings**, so `/reset-password?token=…` can't end up in access logs. |
| **Exposed secrets** | Repository | ✅ `.env` and keys are git-ignored, and only `.env.example` (placeholders) is tracked. A search for key and password patterns found only test fixtures. Production startup refuses a default secret key, a missing vault key, insecure cookies, DEBUG or a development email backend. |
| **CORS** | `main.py` | ✅ Explicit origin list (`FRONTEND_URL` + `CORS_EXTRA_ORIGINS`), credentials allowed only for those, no wildcard. In production the SPA and API share one origin through nginx. |
| **Rate limiting** | Auth, vault unlock, exports, notification checks, account changes | ✅ Per-IP and per-account limits. **Fixed:** with `TRUST_PROXY_HEADERS=true` the client IP is now the **last** `X-Forwarded-For` entry (the one our proxy adds). The first entry is client-controlled and could be forged to dodge limits. nginx overwrites the header with the real address. |
| **Security headers** | API + web server | ✅ API: `nosniff`, `DENY` framing, `default-src 'none'` CSP, COOP, Referrer-Policy, Permissions-Policy, and HSTS over HTTPS. Web (nginx): CSP, `nosniff`, `DENY`, Referrer-Policy, Permissions-Policy, COOP, `server_tokens off`. |
| **Data export** | `/api/account/export` | ✅ Needs the password again, is rate-limited (5 per hour), is audited, and is sent `no-store`. It contains only the signed-in user's rows and never includes hashes, tokens, storage keys or vault secrets. |
| **Account deletion** | `DELETE /api/account` | ✅ Needs the password **and** the typed word `DELETE`. It removes all rows (cascade) and stored files, and clears the session cookie. |
| **Containers** | Production images | ✅ Non-root users, no dev tools in the API image, a read-only root filesystem, `no-new-privileges`, and a database with no published port. |

## 2. Two-factor authentication (design, not yet implemented)

The Settings page and `GET /api/account/two-factor` say honestly that 2FA is **not available
yet**. The design:

1. **Method:** TOTP (RFC 6238, 30 s, 6 digits, SHA-1 for authenticator compatibility) plus 10
   single-use recovery codes.
2. **Storage:**
   - A new `user_mfa` table holds the TOTP secret, **encrypted with the same envelope
     scheme as the vault** (per-user data key, AAD `lifevault:mfa:v1:<user>`).
   - Recovery codes are stored as Argon2id hashes, and each is marked used after use.
3. **Enrolment:** re-enter your password, get the secret as a QR code and text, confirm one
   valid code, then see the recovery codes once. Events are written to the security activity.
4. **Login:** a correct password on an account with 2FA creates a short-lived (5 min),
   single-purpose *pending* session that can only call `POST /api/auth/2fa/verify`. A valid code
   (±1 time step, each step accepted once to block replay) upgrades it to a normal session.
   Attempts are rate-limited per account.
5. **Disable / recover:** needs the password plus a current code or a recovery code. A password
   reset does **not** disable 2FA.

## 3. Known limitations (honest)

- **Server-side vault keys.** The vault is not zero-knowledge: whoever controls the running
  server, or has both the database and the environment, can decrypt it.
- **No 2FA yet** (designed above). A stolen password plus access to the login page is enough
  to sign in.
- **Rate limits live in process memory.** They reset on restart and aren't shared between
  processes, so run one API worker (the default) or move the limiter to a shared store such
  as Redis.
- **Files aren't encrypted at rest.** Documents and profile pictures are stored as plain
  files. Use full-disk encryption on the server and encrypt your backups.
- **Metadata is visible to whoever has the database:** vault site names/URLs, note and
  document titles, and financial records are stored unencrypted. Only vault credentials and
  notes are encrypted.
- **Timezone and currency are server-wide** (`APP_TIMEZONE`, NPR). That's a correctness
  limitation, not a security issue.
- **Browser notifications** can show titles such as "Overdue bill: Rent" on a lock screen.
  They're off by default, and the settings warn about this.
- **Email security** depends on your mail provider. Reset links are single-use and expire
  after 30 minutes.
- **Dependencies** are pinned but not automatically scanned. Run `pip-audit` and `npm audit`
  when you update.
- **Not independently audited.** This review was done as part of development, not by a
  third-party penetration test.

## 4. Operating it safely

- Serve LifeVault **only over HTTPS**, with `COOKIE_SECURE=true`.
- Set `REGISTRATION_ENABLED=false` once your account exists.
- Keep `VAULT_MASTER_KEY`, `APP_SECRET_KEY` and database credentials out of the repository,
  and back up the vault key **separately** from the database.
- Keep the host patched, use disk encryption, and restrict SSH.
- Review **Settings → Security** for unknown sessions or failed sign-ins now and then.
