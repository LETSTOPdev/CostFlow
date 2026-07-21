# 16 — Operations Runbook (P4.2)

Operational procedures for the CostFlow web app deployed to **Railway** with
**managed Postgres** and **Auth0** OIDC, served at **app.fbx1.com** for
invited internal testers only. This document is the human half of P4.2: the
code hardening is in `apps/web`; the steps that require the founder's
accounts and irreversible outward actions are here, because they cannot be
performed from the development environment and must not be simulated.

## 1. Environment variables (all secrets injected by Railway, never committed)

| Variable | Required | Meaning |
|---|---|---|
| `COSTFLOW_ENV` | prod | `production` — enables secure cookies, trusted proxy, HSTS, and strict startup validation |
| `COSTFLOW_SESSION_KEY` | always | base64 of 32 random bytes — signs session cookies |
| `COSTFLOW_CREDENTIAL_KEY` | always | base64 of 32 random bytes — AES-256-GCM key for tenant salts + provider tokens |
| `COSTFLOW_AUTH` | always | `oidc` in production (`dev` is refused when `COSTFLOW_ENV=production`) |
| `COSTFLOW_OIDC_ISSUER` | oidc | e.g. `https://YOUR_TENANT.us.auth0.com/` |
| `COSTFLOW_OIDC_CLIENT_ID` | oidc | Auth0 application client id |
| `COSTFLOW_OIDC_CLIENT_SECRET` | oidc | Auth0 application client secret |
| `COSTFLOW_OIDC_REDIRECT_URI` | oidc | `https://app.fbx1.com/auth/callback` |
| `DATABASE_URL` | prod | Railway Postgres connection string (from the plugin) |
| `PORT` | platform | set by Railway; the app binds `0.0.0.0:$PORT` in production |

Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

Startup refuses to boot (with a named message) if any required variable is
missing or malformed — the server never limps.

## 2. Deploy (founder-run; first-time)

1. **Railway project + Postgres**: create the project, add the Postgres
   plugin. It provides `DATABASE_URL` automatically.
2. **Auth0 application**: create a *Regular Web Application*. Set Allowed
   Callback URL `https://app.fbx1.com/auth/callback`. Note the domain,
   client id, secret. Restrict access to invited testers with an Auth0
   connection allowlist or a login action that rejects non-invited emails
   (internal-testers-only, not public).
3. **Secrets**: set every variable from §1 via `railway variables` or the
   dashboard. Never paste them into code, logs, or chat.
4. **Contract proof (zero-skip)**: point a **disposable** database at the
   suite and run it — this satisfies the "PostgreSQL contract suite passes
   with zero skipped tests" criterion against a real engine:
   ```
   COSTFLOW_TEST_DATABASE_URL="<throwaway Postgres URL>" pnpm test:pg
   ```
   Use a throwaway/test database, NOT the production `DATABASE_URL` (the
   suite inserts fixture tenants). `test:pg` fails fast if the URL is unset,
   so a run with skips can never masquerade as success.
5. **Migrate production**: `railway run pnpm --filter @costflow/web migrate`
   (idempotent — `create ... if not exists`).
6. **Deploy**: `railway up` (builds the Dockerfile). Healthcheck is
   `/healthz`; readiness is `/readyz`.
7. **DNS**: point `app.fbx1.com` at the Railway service; Railway issues the
   TLS certificate. Confirm HTTPS and that `/healthz` returns `{"status":"ok"}`.

## 3. Migrations

- Schema lives in `apps/web/src/store/schema.sql`, applied by
  `pnpm --filter @costflow/web migrate` (or automatically at server boot).
- All statements are `create ... if not exists` — safe to re-run.
- Forward-only in P4.2. A future destructive migration must ship as a new,
  separately-reviewed SQL file with an explicit up/down and a backup taken
  first (§4).

## 4. Backup

- Rely on Railway's managed Postgres automated backups; confirm the schedule
  in the plugin settings.
- On-demand logical backup before any risky change:
  ```
  pg_dump "$DATABASE_URL" --format=custom --file=costflow-$(date +%F).dump
  ```
- Backups contain ENCRYPTED tenant salts and provider tokens (ciphertext
  only) — but treat them as sensitive: they still contain customer emails
  and configuration. Store them encrypted, access-controlled.

## 5. Restore

1. Provision or select the target Postgres.
2. `pg_restore --clean --if-exists --dbname "$TARGET_DATABASE_URL" costflow-YYYY-MM-DD.dump`
3. Point the app's `DATABASE_URL` at the target and redeploy.
4. **Critical**: restore only works with the SAME `COSTFLOW_CREDENTIAL_KEY`
   that was in force when the backup was taken — the salts and tokens are
   encrypted with it. Losing that key makes stored provider tokens
   undecryptable (customers simply reconnect Jira; no data is exposed).

## 6. Credential rotation

- **Session key** (`COSTFLOW_SESSION_KEY`): rotating it invalidates all
  active sessions (everyone re-signs-in). Safe any time; no data effect.
- **Credential key** (`COSTFLOW_CREDENTIAL_KEY`): this encrypts tenant salts
  and provider tokens. It cannot be swapped in place without re-encryption.
  Rotation procedure: (a) take a backup; (b) run a one-off re-encryption that
  decrypts every `token_ciphertext` and `salt_ciphertext` with the old key
  and re-encrypts with the new (a scripted job — not yet built; P4.2 records
  it as the rotation design, to be implemented before the first external
  customer). Until that job exists, rotation = require affected tenants to
  reconnect Jira (tokens re-encrypt under the new key on reconnect) and
  regenerate salts. **Never log either key.**
- **Auth0 client secret**: rotate in Auth0, then update
  `COSTFLOW_OIDC_CLIENT_SECRET` and redeploy.
- **A tenant's Jira token**: the customer revokes it in Atlassian and
  reconnects through the UI; the new token is validated and re-encrypted.

## 7. Rollback

- **App**: Railway keeps prior deploys — roll back to the previous image in
  the dashboard/CLI. Because runs are append-only and migrations are additive
  `if not exists`, an app rollback never conflicts with the schema.
- **Schema**: no destructive migrations exist in P4.2, so app rollback needs
  no schema rollback. When destructive migrations arrive, pair each with a
  tested down-migration and a pre-migration backup.
- **Bad secret**: revert the variable and redeploy; sessions may need to be
  re-established if the session key changed.

## 8. Observability & privacy posture

- Logs are a single sanitized line per request: `{method, path, status,
  durationMs}`. No bodies, headers, tokens, emails, titles, actor values, or
  assumption values ever reach the log (asserted by `hardening.test.ts`).
- Telemetry stays LOCAL by default (P3): derived events live in each run's
  artifacts; interaction/funnel events append to the container-local
  `.costflow/interactions.jsonl` (or `COSTFLOW_TELEMETRY_DIR`). Nothing is
  transmitted off-box — there is no transport. `COSTFLOW_TELEMETRY=off`
  disables the interaction log. Any future outward telemetry requires
  explicit opt-in machinery that does not exist yet.

## 9. Live end-to-end acceptance (founder-run, on the deployment)

Run once on app.fbx1.com and record the result back into doc 09:

1. Sign in via Auth0 (invited tester account).
2. Connect a real Jira workspace (site, email, API token).
3. Select a project.
4. Map every observed status to a stage kind.
5. Map people to roles (leave some blank to confirm pseudonymization).
6. Accept or customize assumptions (confirm the provenance labels).
7. Run analysis; wait for the job to succeed.
8. View the report.
9. Sign out (dashboard → Sign out).
10. Sign back in; open **Runs**; confirm the persisted run renders identically.

Then verify, out of band: the container log for the session contains no
token/email/title/actor/assumption value; `interactions.jsonl` contains only
counts/enums; the Postgres `workspaces.token_ciphertext` is ciphertext, not
the raw token.

## 10. Success criteria status (honest ledger)

| Criterion | Status |
|---|---|
| Postgres contract suite, zero skips | Harness ready (`pnpm test:pg`); RUN pending on a real DB (founder) |
| Live OIDC flow succeeds | Adapter + Auth0 config ready; live run pending (founder) |
| Deployed E2E Jira journey | Deploy kit ready; run pending on app.fbx1.com (founder) |
| CLI / engine / goldens byte-identical | ✅ verified (git diff empty; full suite green) |
