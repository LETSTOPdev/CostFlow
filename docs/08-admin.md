# Operating CostFlow

Deploying, configuring, and debugging production.

---

## Production

| | |
|---|---|
| Application | https://app.fbx1.com |
| Health | https://app.fbx1.com/healthz |
| Repository | https://github.com/LETSTOPdev/CostFlow (`origin`, the only remote) |
| Hosting | Railway, 2 replicas |
| Database | PostgreSQL on Railway |
| Auth | Auth0 (OIDC) |

`/healthz` returns `{"status":"ok","commit":"<full sha>"}` — the deployed commit,
which is how you confirm a deploy landed.

---

## Deploying

**Deploy is `git push origin main`.** There is no separate deploy step and no
staging environment.

Railway then builds, runs `pnpm --filter @costflow/web migrate` in a
**pre-deploy phase** (never chained with start), and gates the release on the
healthcheck.

Migrations are idempotent: `schema.sql` is re-applied in full on every deploy,
using `create table if not exists` and `create index if not exists` throughout,
with backfills written to be safely re-runnable.

The checklists for before and after a push are in
[`09-ai-context.md` §9](09-ai-context.md).

---

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection. Required unless `COSTFLOW_STORE=memory`. |
| `COSTFLOW_SESSION_KEY` | Signs session cookies. |
| `COSTFLOW_CREDENTIAL_KEY` | AES-256-GCM key for connector secrets and org salts. |
| `COSTFLOW_ADMIN_EMAILS` | Comma-separated allowlist for `/admin`. Inert if unset. |
| `COSTFLOW_AUTH` | `auth0` in production; `dev` locally. |
| Auth0 settings | Domain, client id, client secret, callback URL. |
| `COSTFLOW_STORE` | `memory` for a throwaway demo. Never in production. |
| `COSTFLOW_MAX_ISSUES` | Optional item ceiling, counted across the whole scope selection. Default 50,000. |
| `COSTFLOW_MAX_SCOPES` | Optional cap on how many scopes one workspace may select. Default 25. |

### Getting a ClickUp API token

Verified against the live ClickUp UI, July 2026. **ClickUp's own developer
documentation is stale** and still gives the old "Settings → Apps" path.

Avatar (top right) → **Settings** → under *Integrations & ClickApps*, **ClickUp
API** → under **API Token**, click **Copy**. Tokens start with `pk_`.

Use **Regenerate** only if there is no token yet: it asks for the account
password and invalidates the existing token, breaking anything already using it.

Wait-time analysis additionally needs the **Total Time in Status** ClickApp,
which a Workspace admin enables.

**Configuration is read at boot.** Changing a variable requires a redeploy.

Auth0 itself is configured in the Auth0 dashboard, not in code. Sign-up and
login problems are usually a leftover denying Action or a cookie `SameSite`
setting.

---

## The admin console

Twenty routes at `/admin`: executive dashboard, customer database with
per-customer detail, activity feed, onboarding funnel, monitoring workspaces,
organisations, users, workspaces, jobs, runs, invitations, audit log, global
search, system diagnostics, and three audited actions (change a user's role,
revoke a pending invitation, retry a failed import).

**Read-only by default.** Actions are CSRF-protected and written to an audit log
whose table carries no foreign keys, so its rows survive tenant erasure. No hard
deletes. Projections never include a secret or raw financial run content —
pinned by tests asserting known secret strings never appear in any console HTML.

Server-rendered like the rest of the product: search, filter, sort and pagination
are GET query parameters. Sort columns come from a literal whitelist because
`order by` cannot be parameterised.

### Getting in

1. Add your email to `COSTFLOW_ADMIN_EMAILS` in the Railway service variables.
2. Redeploy — configuration is read at boot.
3. Sign in normally, then open `/admin`.

The email is compared against the address **Auth0 returns**, lowercased and
trimmed on both sides. If you signed up through Google, that is the address to
use, whatever you think you registered with.

### Why a rejection looks like a missing page

A non-admin gets **404, not 403**, deliberately: the console's existence is not
disclosed to anyone probing for it. The 404 page also renders through the public
layout, so it shows the logged-out header **even when you are signed in**. That
header tells you nothing about your session.

Distinguishing the two cases:

- **Not signed in** → redirected to `/login`. You would be looking at the sign-in
  page, not a 404.
- **Signed in, not on the allowlist** → the 404 page.

So a 404 means the session check passed and the allowlist rejected you.

---

## Debugging production

### `/admin` returns 404

Open the Railway deploy logs, hit `/admin`, and look for `admin-denied`:

```json
{"level":"warn","msg":"admin-denied","hasAllowlist":false,"allowlistSize":0,"hasUser":true}
```
The variable is not reaching the application. Wrong service, wrong environment,
or the redeploy did not happen.

```json
{"level":"warn","msg":"admin-denied","hasAllowlist":true,"allowlistSize":1,"hasUser":true}
```
It is set and your email does not match. Compare it against the address shown in
your CostFlow account settings.

No `admin-denied` line at all → you were not signed in; the request redirected
before reaching the gate.

The line carries booleans and a count only, never the email tried and never the
allowlist contents.

### A report returns 500 with "withheld"

The attribution guard fired: a raw actor identity reached the rendered bytes.
The log line is `attribution-guard-blocked` with a **count only** — never the
value, which is the point.

This is a fail-closed guard working. Investigate why an identity survived
pseudonymisation rather than relaxing the guard.

### An import failed

`/admin/jobs` shows job status and a sanitised error class. Retry is available
behind a confirmation page, since it re-fetches from the customer's connector.

Gateway errors carry a stage label and, when the server answered, an HTTP status
— never a URL, credentials, or customer data.

### Checking what the running instance believes

`/admin/system` shows the commit SHA, environment, replica identity, uptime,
memory, Node version, a database ping with latency, and the effective non-secret
configuration flags. It is the fastest way to confirm a variable actually
reached production — though it is behind the same gate as everything else.

---

## Log conventions

Structured JSON to stdout, one object per line, collected by Railway.

**Logs carry booleans, enums, ids and counts only.** Never emails, tokens,
salts, item titles, or customer content. A count of leaked values is fine; the
values are not. When adding a log line, assume it will be read by someone who
should not see customer data.

---

## Local development

`.claude/launch.json` runs the web app with dev auth and an in-memory store on
port 3900. Dev auth accepts any email with no password, and the local admin
allowlist is preconfigured, so `/admin` opens immediately.

Nothing local touches production data.

---

## Data handling

`partner-runs/` holds **real customer data** and is git-ignored. Never commit it,
never print raw actor values, and keep findings local. Its notes are reviewed by
nothing and have been wrong — see R5 in `06-known-risks.md`.

Customer secrets are AES-256-GCM ciphertext at rest, decrypted only at the moment
of use, never rendered and never logged.
