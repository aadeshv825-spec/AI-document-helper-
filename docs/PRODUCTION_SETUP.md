# Production Setup and Release Checklist

This document lists every step that must be done **outside the repository**
(Google Cloud, Google Play Console, email provider, GitHub settings). None of
these steps can be completed from the code alone. Values in `<ANGLE_BRACKETS>`
must be replaced with your real values; nothing here is a real credential.

---

## 1. Storage status and behaviour

| Mode | When | Durability |
| --- | --- | --- |
| PostgreSQL (`server/db.ts`) | `DATABASE_URL` is set | Permanent |
| JSON files in `data/` | `DATABASE_URL` unset and `REQUIRE_DATABASE` not `true` | **Temporary on Cloud Run** (lost on every new revision/instance) |
| Refuses to start | `REQUIRE_DATABASE=true` and `DATABASE_URL` unset | — (verified by `tests/postgres.test.ts`) |

How the PostgreSQL mode works:

- Schema migrations run automatically at startup inside a transaction with an
  advisory lock. Migrations are append-only and never drop data.
- Data is loaded into memory at startup and **every change is written through
  to PostgreSQL in order**.
- A state-changing API request only returns success after PostgreSQL has
  confirmed its writes. If the database is down, the request returns HTTP 503
  (`persistenceFailed: true`) instead of a false success; the change stays
  queued and is written automatically when the database comes back
  (verified by the outage test in `tests/postgres.test.ts`).
- `GET /api/health` reports `storage.connected`, `pendingWrites` and
  `failedWrites`; `GET /api/health/ready` returns 503 when the database does not
  answer.
- On `SIGTERM` the server stops accepting requests, waits (max 25 s) for pending
  writes, then closes the pool.
- The daily free limit is checked and reserved in one synchronous step, so
  concurrent requests cannot exceed 5/day; failed AI requests are refunded.

**Single instance is required.** Because reads are served from the in-memory
copy, two instances would not see each other's changes and could both allow
the last free action. Always deploy with `--max-instances=1` (and
`--min-instances=0` or `1`). Password-reset links, Google sign-in nonces and
rate limits are also kept in memory and are lost on restart (users simply
retry).

---

## 2. Cloud SQL for PostgreSQL

```bash
PROJECT=<GCP_PROJECT_ID>
REGION=asia-southeast1                # same region as Cloud Run
INSTANCE=ai-doc-helper-db

gcloud sql instances create $INSTANCE \
  --project=$PROJECT --region=$REGION \
  --database-version=POSTGRES_16 --tier=db-f1-micro \
  --storage-auto-increase --backup-start-time=20:30 \
  --enable-point-in-time-recovery

gcloud sql databases create ai_document_helper --instance=$INSTANCE --project=$PROJECT
gcloud sql users create app_user --instance=$INSTANCE --project=$PROJECT --prompt-for-password
```

The application user only needs privileges on its own database (it creates
its tables on first start).

## 3. Secret Manager

Create secrets **without typing values into shell history** (use
`--data-file=-` and paste, or a file you delete afterwards):

| Secret | Value |
| --- | --- |
| `DATABASE_URL` | `postgresql://app_user:<PASSWORD>@/ai_document_helper?host=/cloudsql/<PROJECT>:<REGION>:<INSTANCE>` |
| `GEMINI_API_KEY` | Gemini API key |
| `GOOGLE_CLIENT_SECRET` | OAuth web client secret |
| `RESEND_API_KEY` | Resend API key (password reset email) |

```bash
gcloud secrets create DATABASE_URL --project=$PROJECT --data-file=-
```

Grant the Cloud Run runtime service account:

- `roles/cloudsql.client`
- `roles/secretmanager.secretAccessor`

## 4. Back up the current live data BEFORE switching

The currently deployed service keeps its data in `data/*.json` inside the
container. **Copy those files before deploying a new revision**, otherwise they
are lost. Keep the copy offline; it contains password hashes.

## 5. Deploy Cloud Run (example)

```bash
gcloud run deploy <SERVICE_NAME> \
  --project=$PROJECT --region=$REGION --source=. \
  --max-instances=1 \
  --add-cloudsql-instances=$PROJECT:$REGION:$INSTANCE \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,RESEND_API_KEY=RESEND_API_KEY:latest \
  --set-env-vars=NODE_ENV=production,REQUIRE_DATABASE=true,APP_URL=https://<PRODUCTION_DOMAIN>,GOOGLE_CLIENT_ID=<WEB_CLIENT_ID>,PASSWORD_RESET_EMAIL_FROM="AI Document Helper <no-reply@<VERIFIED_DOMAIN>>",RTDN_PUSH_AUDIENCE=https://<PRODUCTION_DOMAIN>/api/billing/google-play/rtdn,RTDN_PUSH_SERVICE_ACCOUNT=<PUSH_SA_EMAIL>
```

The service must be built with `npm run build` and started with `npm start`
(`node dist/server.cjs`). The repository has no Dockerfile; if you deploy with
`--source`, confirm in the Cloud Build log that the build step ran
`npm run build` (add a `gcp-build` script or a Dockerfile if it did not).
Use Node.js 22 (`engines.node` in `package.json`).

## 6. Import the backed-up JSON data

Either place the files in `data/` inside the container for the first start
(imported automatically once), or import from your machine through the Cloud
SQL Auth Proxy:

```bash
cloud-sql-proxy $PROJECT:$REGION:$INSTANCE --port 5433 &
DATABASE_URL="postgresql://app_user:<PASSWORD>@127.0.0.1:5433/ai_document_helper" \
  npm run db:import-json -- /path/to/backup-dir
```

Guarantees (tested): runs in one transaction; existing rows are never
overwritten (conflicts are skipped and reported); the same source is imported
at most once; source files are not modified; plaintext session tokens from old
files are stored only as SHA-256 hashes.

Verify afterwards:

```sql
SELECT count(*) FROM app_users;
SELECT count(*) FROM app_documents;
SELECT count(*) FROM app_purchases;
SELECT * FROM app_json_imports;
```

## 7. Backup, restore and rollback

- Automated daily backups + point-in-time recovery are enabled by the
  `instances create` command above.
- Manual backup before every deploy: `gcloud sql backups create --instance=$INSTANCE`.
- Logical export: `gcloud sql export sql $INSTANCE gs://<BUCKET>/backup-$(date +%F).sql --database=ai_document_helper`.
- Restore: `gcloud sql backups restore <BACKUP_ID> --restore-instance=$INSTANCE`
  (overwrites the instance — only after confirming which backup to use).
- Application rollback: `gcloud run services update-traffic <SERVICE_NAME> --to-revisions=<PREVIOUS_REVISION>=100`.
  Migrations only add tables/indexes, so an older revision keeps working.
- Never roll back to a revision **without** `DATABASE_URL`: it would start on
  empty temporary JSON storage. `REQUIRE_DATABASE=true` prevents that.

## 8. Password reset email (Resend)

1. Create a Resend account, add and verify your sending domain (DNS records).
2. Create an API key with "sending" permission → secret `RESEND_API_KEY`.
3. Set `PASSWORD_RESET_EMAIL_FROM` to an address on the verified domain.
4. `APP_URL` must be the public `https://` URL; links go to `APP_URL/reset-password#token=…`
   (the token is in the URL fragment, so it is not sent to servers or logs).

Until this is configured, "Forgot password" honestly reports that email reset is
unavailable. Signed-in users can still change their password in Profile.

## 9. Google Play Real-time Developer Notifications (RTDN)

1. Enable the **Cloud Pub/Sub API** in the Google Cloud project linked to Play.
2. Create a topic, e.g. `play-rtdn`, and grant
   `google-play-developer-notifications@system.gserviceaccount.com` the
   **Pub/Sub Publisher** role on it.
3. Create a service account for push authentication, e.g.
   `rtdn-push@<PROJECT>.iam.gserviceaccount.com` (no keys needed).
4. Create a **push** subscription with authentication:
   ```bash
   gcloud pubsub subscriptions create play-rtdn-push --topic=play-rtdn \
     --push-endpoint=https://<PRODUCTION_DOMAIN>/api/billing/google-play/rtdn \
     --push-auth-service-account=rtdn-push@<PROJECT>.iam.gserviceaccount.com \
     --push-auth-token-audience=https://<PRODUCTION_DOMAIN>/api/billing/google-play/rtdn \
     --ack-deadline=60
   ```
5. Set `RTDN_PUSH_AUDIENCE` (the audience above) and `RTDN_PUSH_SERVICE_ACCOUNT`
   (the push service account email) on Cloud Run.
6. Play Console → **Monetize with Play → Monetization setup → Real-time developer
   notifications**: enter topic `projects/<PROJECT>/topics/play-rtdn`, then
   **Send test notification** and check the Cloud Run log for
   `[RTDN] Test notification received.`

Processing rules: the push token (Google signature, audience, service account)
is verified; every subscription event is re-checked with the Play Developer
API before granting or removing Pro; cancelled subscriptions keep Pro until
expiry; expired/on-hold/paused end Pro; refunds/revocations (voided purchases)
end Pro; manually granted Pro and admin accounts are not changed; repeated
messages are harmless. Without these settings the endpoint returns 503 and the
existing renewal re-check at sign-in (`/api/auth/me`) still applies.

The Cloud Run service account also needs access to the Play Developer API:
Play Console → Users and permissions → invite the service account with
"View financial data" and "Manage orders and subscriptions".

## 10. Android release

### 10.1 Signing key (manual, required before any upload)

The old keystore `android/app/release.keystore` and its password were public
(committed in Git history and inside `android-project.zip/.tar.gz`). Treat it
as compromised and never use it again.

1. Play Console → **Test and release → App integrity → App signing** →
   **Request upload key reset**, upload the certificate (`.pem`) of the new
   upload key that is stored in GitHub secrets `NEW_UPLOAD_KEYSTORE_BASE64` /
   `NEW_UPLOAD_KEY_PASSWORD` (alias `upload`).
2. Wait for Google's confirmation email that the new upload key is active.
3. Put the new certificate's SHA-256 fingerprint (from that confirmation or
   App integrity page) into the repository **variable**
   `EXPECTED_UPLOAD_CERT_SHA256`, format `AA:BB:...`. The release workflow
   then fails if the AAB is signed with any other key.
4. Delete the obsolete GitHub secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`,
   `KEY_ALIAS`, `KEY_PASSWORD` (old key).

### 10.2 Production backend URL

Set the repository **variable** `PRODUCTION_API_BASE_URL` (Settings → Secrets
and variables → Actions → Variables) to the real production `https://` URL.
The release build refuses to run without it and rejects development
(`ais-dev-…`) URLs. The app no longer contains any built-in backend URL.

### 10.3 versionCode

Play Console → **Test and release → App bundle explorer** shows the highest
uploaded versionCode. Run the release workflow with a higher `version_code`
(the workflow also requires it to be greater than 7, the highest value in this
repository's history).

### 10.4 Build

GitHub → Actions → **Build Android Release AAB** → Run workflow (inputs:
`version_code`, `version_name`). The workflow runs type checks, tests, a clean
web build, regenerates Android assets from that build (the assets folder is
not committed), builds and signs the AAB, and verifies package name,
versionCode, non-debuggable manifest, signature certificate and that no
development URL, source map, backend bundle or key is inside.

### 10.5 App Links (optional)

App Links were removed from the manifest because they pointed to a development
host and the app does not handle incoming links. To add them later:
add an `intent-filter` with `android:autoVerify="true"` for the production
domain and put the **App signing key** SHA-256 (Play Console → App integrity →
App signing key certificate) into `public/.well-known/assetlinks.json`
(served at `https://<PRODUCTION_DOMAIN>/.well-known/assetlinks.json`).

## 11. Git history clean-up (optional, destructive — needs explicit approval)

The history contains the old keystore, `android-project.zip/.tar.gz` and old
`data/users.json` / `data/sessions.json`. Rotating the key (10.1) is what
actually removes the risk; rewriting history only reduces exposure.

1. Backup first: `git clone --mirror https://github.com/aadeshv825-spec/AI-document-helper-.git backup.git`
   (keep it offline). Branch `backup/pre-final-2951b8b` also exists on GitHub,
   but a history rewrite must update all branches.
2. `pip install git-filter-repo`, then in a fresh mirror clone:
   ```bash
   git filter-repo --invert-paths \
     --path android/app/release.keystore \
     --path public/android-project.zip --path public/android-project.tar.gz \
     --path android/app/src/main/assets/public/android-project.zip \
     --path android/app/src/main/assets/public/android-project.tar.gz \
     --path data/users.json --path data/sessions.json
   git push --force --mirror
   ```
3. Ask GitHub Support to purge cached views/forks; anyone who cloned earlier
   still has the old data. Make the repository private afterwards if desired.

## 12. Environment variable reference

| Variable | Where | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Cloud Run | `production` |
| `REQUIRE_DATABASE` | Cloud Run | `true` — never start without PostgreSQL |
| `DATABASE_URL` | Secret | PostgreSQL connection string |
| `GEMINI_API_KEY` | Secret | Gemini API |
| `GOOGLE_CLIENT_ID` | Env | OAuth web client ID (also the Android server client ID) |
| `GOOGLE_CLIENT_SECRET` | Secret | OAuth web client secret |
| `APP_URL` | Env | Public https URL (OAuth redirects, reset links) |
| `ALLOWED_ORIGINS` | Env | Optional extra CORS origins (comma separated) |
| `RESEND_API_KEY` | Secret | Password reset email |
| `PASSWORD_RESET_EMAIL_FROM` | Env | Sender on a verified domain |
| `RTDN_PUSH_AUDIENCE` | Env | Pub/Sub push token audience |
| `RTDN_PUSH_SERVICE_ACCOUNT` | Env | Pub/Sub push service account email |
| `PRODUCTION_API_BASE_URL` | GitHub variable | Backend URL baked into the Android build |
| `EXPECTED_UPLOAD_CERT_SHA256` | GitHub variable | Approved upload certificate fingerprint |
