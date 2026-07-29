# Operating CostFlow

Deploying, configuring, and debugging production.

---

## Production

| | |
|---|---|
| Marketing site | https://fbx1.com (and `www.` → apex) |
| Application | https://app.fbx1.com |
| Health | https://app.fbx1.com/healthz |
| Repository | https://github.com/LETSTOPdev/CostFlow (`origin`, the only remote) |
| Marketing hosting | Vercel, project `costflow-marketing`, prerendered static + one function |
| Application hosting | Railway, 2 replicas |
| Database | PostgreSQL on Railway |
| DNS | Namecheap (`dns1/dns2.registrar-servers.com`) |
| Auth | Auth0 (OIDC), on `app.fbx1.com` only |

`/healthz` returns `{"status":"ok","commit":"<full sha>"}` — the deployed commit,
which is how you confirm a deploy landed.

---

## Deploying

**Deploy is `git push origin main`.** There is no separate deploy step and no
staging environment. One push deploys both sides, in parallel and independently.

Railway builds the application, runs `pnpm --filter @costflow/web migrate` in a
**pre-deploy phase** (never chained with start), and gates the release on the
healthcheck.

Vercel builds the marketing site with
`pnpm --filter @costflow/marketing build`, which writes Vercel's Build Output
API v3 directory — every page as a file, two functions for `/try` and
`/try/report`, and a generated `config.json` holding the headers, the redirects
to the application, and the 404. Pull requests get a preview deployment at their
own URL; nothing but `main` reaches `fbx1.com`.

Either side can fail without the other: a broken marketing build leaves the last
good CDN deployment serving, and a failed Railway healthcheck leaves the last
good release running.

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
| `COSTFLOW_MARKETING_URL` | Optional override for where the marketing site lives. Unset — which is what production uses — it is `https://fbx1.com`. Set it only to point a deployment at a preview or a local marketing site. |

The marketing site needs **no environment variables at all**. It has no session,
no database and no secrets, and both origins are constants in
`packages/ui/src/site.ts` — an origin only one of the two deployments knows
about is an origin the two can disagree on.

## The two hostnames

`https://fbx1.com` is the marketing site, on Vercel. `https://app.fbx1.com` is
the application, on Railway. `www.fbx1.com` redirects to the apex, configured on
the Vercel domain rather than in code, so there is one canonical marketing
origin rather than two competing for the same index entry.

**Nothing about authentication is cross-origin.** `/login`, `/signup`,
`/auth/callback` and `/logged-out` are application paths, the session cookie is
host-only, and the Auth0 callback and post-logout URLs name `app.fbx1.com`
alone. There is nothing in Auth0 to reconfigure, and nothing about the marketing
site can break sign-in.

### DNS

| Record | Host | Value |
|---|---|---|
| `A` | `@` | `216.198.79.1` (Vercel) |
| `CNAME` | `www` | `cname.vercel-dns.com` |
| `CNAME` | `app` | `lklcoo55.up.railway.app` (Railway, unchanged) |

The apex uses an `A` record because Namecheap's BasicDNS cannot `CNAME` an apex.
`app` is untouched by any of this: the application's DNS never moved.

### Verifying both hosts

```bash
curl -sI https://fbx1.com/pricing | head -1                 # 200
curl -sI https://app.fbx1.com/pricing | grep -i location    # → https://fbx1.com/pricing
curl -sI https://fbx1.com/dashboard | grep -i location      # → https://app.fbx1.com/dashboard
curl -sI https://www.fbx1.com/docs | grep -i location       # → https://fbx1.com/docs
curl -sI https://fbx1.com/nothing-here | head -1            # 404, branded
curl -s https://fbx1.com/ | grep -c 'https://app.fbx1.com/signup'   # CTAs point at the app
curl -s https://app.fbx1.com/ | grep -c 'Create account'    # the way in, not the landing
curl -sI https://fbx1.com/ https://app.fbx1.com/ | grep -c '301'    # 0 — the root never moves
curl -s https://fbx1.com/robots.txt | grep Sitemap          # one sitemap, on the public host
curl -s https://app.fbx1.com/robots.txt | grep -c Sitemap   # 0 — it does not claim one
```

Then sign in, run an analysis and sign out on `app.fbx1.com`. Sessions,
callbacks and logout are unaffected by the split, but that is the flow whose
breakage would be worst, so it is the one to walk.

### Rolling back

The two sides roll back independently, and neither takes the other down.

**The marketing site** — `vercel rollback <previous-deployment-url>`, or
promote a previous deployment from the Vercel dashboard. Seconds, no DNS change,
no code change. The application is unaffected.

**The application** — revert the commit and push, as with any other release.

**Both hostnames at once**, if the marketing site had to disappear entirely:
point the apex `A` record back to nothing and set `COSTFLOW_MARKETING_URL` in
Railway to `https://app.fbx1.com`… which the config refuses, deliberately,
because it would redirect every marketing URL to itself. There is no
one-variable way back to a single host, and that is the trade the split makes:
the marketing pages live in `apps/marketing` now and the application no longer
carries a copy. Restoring one host means reverting the split commit.

### Search Console

`fbx1.com` and `app.fbx1.com` are separate properties. Submit
`https://fbx1.com/sitemap.xml` under the `fbx1.com` property. The application
host stays crawlable on purpose so its 301s transfer the index entries it holds
from when it served the public site — **do not add `Disallow: /` to it.**

---

## Getting a ClickUp API token

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
