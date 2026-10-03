# Production Setup: Permanent Storage and Security Checklist

## 1. Current storage status

- Without `DATABASE_URL`, the server stores users, sessions, documents, usage and
  purchases in `data/*.json`. On Cloud Run this is **temporary** instance storage
  and is lost whenever an instance is replaced or a new revision is deployed.
- With `DATABASE_URL`, the server uses PostgreSQL (`server/db.ts`). Schema
  migrations run automatically at startup (append-only, non-destructive).

## 2. Provision PostgreSQL (Cloud SQL)

1. Create a Cloud SQL for PostgreSQL instance (same region as the Cloud Run service).
2. Create a database (e.g. `ai_document_helper`) and a dedicated user with a strong password.
3. Store the connection string in Secret Manager, e.g. secret `DATABASE_URL`:
   `postgresql://DB_USER:DB_PASSWORD@/DB_NAME?host=/cloudsql/PROJECT:REGION:INSTANCE`
4. Grant the Cloud Run service account `roles/cloudsql.client` and
   `roles/secretmanager.secretAccessor`.
5. Deploy Cloud Run with:
   - `--add-cloudsql-instances PROJECT:REGION:INSTANCE`
   - `--set-secrets DATABASE_URL=DATABASE_URL:latest`
   - `--set-env-vars REQUIRE_DATABASE=true,NODE_ENV=production`
   - `--max-instances=1` (required for now, see section 4)

## 3. Migrating existing JSON data (no data is deleted or overwritten)

- On the first start with `DATABASE_URL`, any `data/*.json` files present in the
  container are imported once. Existing database rows are never overwritten;
  conflicts are skipped and logged. The JSON files are left untouched.
- To import a backup copied from elsewhere:
  `DATABASE_URL=... npm run db:import-json -- /path/to/backup-dir`
  The import runs in a single transaction (all-or-nothing) and each source
  directory is imported at most once.
- **Before switching**, copy any `data/*.json` from the currently running
  instance if you need it; Cloud Run instance storage is not durable.
- Plaintext session tokens from older `sessions.json` files are converted to
  SHA-256 hashes during import and load.

## 4. Known limitation: single instance

Reads are served from an in-memory cache that is hydrated from PostgreSQL at
startup, and every change is written through to PostgreSQL in order. Running
more than one instance would let caches diverge, so keep `--max-instances=1`
until reads are moved to direct database queries. Pending writes are flushed on
`SIGTERM`.

## 5. Other required environment / secrets

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Gemini API (Secret Manager) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth web client (Secret Manager for the secret) |
| `APP_URL` | Public HTTPS URL of the service (OAuth redirect allowlist) |
| `DATABASE_URL` | PostgreSQL connection string (Secret Manager) |
| `REQUIRE_DATABASE` | `true` in production |
| `ALLOWED_ORIGINS` | Optional extra CORS origins |
| `VITE_API_BASE_URL` | Optional build-time backend URL for the frontend |
| `RESEND_API_KEY` | Resend API key used to send password reset emails (Secret Manager). Without it, "Forgot password" honestly reports that email reset is unavailable. |
| `PASSWORD_RESET_EMAIL_FROM` | Sender address on a domain verified in Resend, e.g. `AI Document Helper <no-reply@yourdomain.com>` |

Password reset notes:

- `APP_URL` must be an `https://` URL; reset links point to `APP_URL/reset-password`.
- Reset tokens are single-use, valid for 30 minutes, and stored (hashed) in
  server memory, so a restart invalidates outstanding links. This matches the
  single-instance requirement above.
- The owner account cannot be reset by email.

The Cloud Run service account also needs access to the Google Play Developer
API (Play Console > Users and permissions) for purchase verification.

## 6. Signing key incident (manual action required)

`android/app/release.keystore` was committed to this public repository, and its
password was displayed in the app UI and bundled JavaScript. Removing the files
does not remove them from Git history, so that key must be treated as
compromised. See the security report for the Play Console steps.
