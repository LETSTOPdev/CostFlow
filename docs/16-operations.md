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
| Postgres contract suite, zero skips | ✅ PASSED on real Railway Postgres — see §11 (1 file, 10 tests, 0 skipped, 386ms) |
| Live OIDC flow succeeds | ✅ sign-in / callback / session / sign-back-in PASSED on the deployment |
| Invited-testers-only restriction | ✅ PASSED (non-invited emails rejected) |
| Logout SSO termination | ⚠️ DEFERRED — known non-blocking defect **D-19** (§11 Gate 2); Gate 2 left OPEN |
| Deployed E2E Jira journey | ✅ PASSED on https://app.fbx1.com — see §11 Gate 3 |
| Logs & telemetry privacy audit | ✅ PASSED (no credentials/titles/actor values/emails/customer vocabulary/assumption values) |
| CLI / engine / goldens byte-identical | ✅ verified (git diff empty; full suite green) |

**P4.2 is CONDITIONALLY COMPLETE (2026-07-22)** with exactly one deferred
non-blocking defect: **D-19 — logout SSO termination** (Gate 2 stays OPEN).
Gates 1 and 3 passed on real infrastructure. **Logout must be resolved
before production hardening / broad customer launch** — see §11 Gate 2 and
doc 09 for the full defect record and the FOLLOW-UP-LOGOUT item.

## 11. Live acceptance evidence

### Gate 1 — Postgres migration + zero-skip contract suite (PASSED 2026-07-21)

Sanitized evidence (service/variable names only — no DB URL, password,
token, or connection-string value was exposed):

1. **Production migration** — Railway web console ran
   `pnpm --filter @costflow/web migrate` against the production Railway
   Postgres (via `DATABASE_URL`). Result: SUCCESS —
   "Migration applied and database reachable."
2. **Disposable test database** — a SEPARATE Railway Postgres service
   (`Postgres-MmLy`) was used only for contract testing;
   `COSTFLOW_TEST_DATABASE_URL` referenced that disposable service. The
   production DB was never used for tests (per §2 step 4).
3. **Contract suite** — `pnpm test:pg` → Test Files: 1 passed · Tests:
   10 passed · Skipped: 0 · Duration: 386ms. Zero-skip criterion met on a
   real Postgres engine.
4. **Cleanup** — `COSTFLOW_TEST_DATABASE_URL` removed; disposable service
   `Postgres-MmLy` and its orphaned volume deleted; only production Postgres
   remains.
5. **Privacy** — only service and variable NAMES were recorded; no secret
   value was exposed.

Local-agent corroboration (this repo, HEAD ef86159): full local gate green
(`pnpm check` — typecheck + lint + prettier + dependency-cruiser 0 violations
+ vitest 239 passed / 1 skipped, the single skip being the pg contract when
no test DB is bound locally); goldens, engine packages, and telemetry
`derive.ts` byte-identical to the pre-web baseline `e3c86e6`.

### Gate 2 — live Auth0 flow + invited-testers-only (NOT PASSED — deferred defect D-19)

Sign-in, authorization-code callback, session establishment,
invited-testers-only gating (non-invited emails rejected), and sign-back-in
all succeeded on the deployment. **Logout SSO termination is a known
non-blocking defect (D-19)** and Gate 2 is deliberately left OPEN.

Defect summary (full record in doc 09 §"Deferred defect D-19"):

- App-side `POST /logout` validates session + CSRF, clears cookies, and
  returns **302** to Auth0 `/oidc/logout` with `client_id` + encoded
  `post_logout_redirect_uri`. Production diagnostic (`logout-attempt`, commit
  `2fb63ef`) confirmed on a real request:
  `session_present:true, csrf_present:true, csrf_match:true, status:302`.
  Faithful cookie-jar regression suite passes.
- Auth0 `/oidc/logout` works when reached directly (returns to
  `/logged-out`).
- Browser-visible behavior is unreliable; the one reproducible 503 occurred
  only inside a Claude-controlled/debugged browser (automation artifact).
- **No confirmed data loss, security leakage, or corruption.** Residual risk:
  the Auth0 tenant SSO session may not always terminate in-browser, enabling
  a silent re-auth on a protected route.
- **FOLLOW-UP-LOGOUT (blocks broad launch):** retest in a fully independent
  browser; if the failure is proven to occur *after* CSRF validation,
  evaluate `id_token_hint` on `/oidc/logout`. Not implemented now; CSRF not
  weakened. The sanitized `logout-attempt` diagnostic is intentionally
  retained as the instrument for this follow-up.

### Gate 3 — deployed Jira E2E + privacy audit (✅ PASSED 2026-07-22)

Independent-browser acceptance run on https://app.fbx1.com. All steps
passed: Jira import (real projects) · status→stage-kind mapping · actor→role
mapping (pseudonymization) · assumption accept/customize (provenance) ·
analysis run (job succeeded) · report generation · Runs page (`GET /runs`
200) · run persistence across a fresh session. Privacy audit: no
credentials, tokens, titles, actor values, emails, customer vocabulary, or
assumption values in logs or telemetry.

Deployment evidence (sanitized): `main` lineage `00d41a0 → 8a183d3 →
a363e7a → 2fb63ef` served on Railway; `/healthz` 200 and `/readyz` 200
stable. Railway deployment UUIDs (e.g. `c3250dcc`) are not git commits.
