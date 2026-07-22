# 17 — Launch Operations Pack (v1 free public beta)

Everything the founder must do to take CostFlow live and run it. This is
specific to the current implementation: Fastify app in `apps/web` (no build
step; runs from source via `tsx`), served at **app.fbx1.com** on **Railway**
with **managed Postgres** and **Auth0** OIDC. After this document there is
nothing left but founder-operated launch activities.

**Current production facts (as of 2026-07-22):**
- Railway project `considerate-passion` (`6dbe80f7-…`), environment `production`
  (`9ff1b900-…`), service **costflow** (`01226098-…`), region US West, 1 replica.
- Postgres service in the same project (with `postgres-volume`).
- Serving `main` HEAD; deploy pipeline: Docker build → **pre-deploy** `migrate`
  → `start` → `/healthz` healthcheck. Migration is idempotent
  (`create/add-column if not exists`).
- The app is public-ready in code; **the doors are still closed at Auth0**
  (invited-testers gate). Opening them is step 1 of go-live.

---

## 1. Founder launch checklist (do all of these before opening the product)

- [ ] Read this whole pack once.
- [ ] Confirm you can log in to **Railway** (project `considerate-passion`) and
      **Auth0** (the tenant behind `COSTFLOW_OIDC_ISSUER`), and that you own DNS
      for **fbx1.com**.
- [ ] Complete the Auth0 checklist (§2) — this is what actually opens signup.
- [ ] Complete the Railway checklist (§3) and Environment checklist (§5).
- [ ] Confirm the support mailbox (§6).
- [ ] Confirm backups (§7) and set up at least one uptime alert (§8).
- [ ] Skim the security (§9) and legal (§10) checklists; they're mostly already
      done in code — you're verifying, not building.
- [ ] Run the **founder smoke test** (see §11) once against production with a
      brand-new email and a real Jira token. This is the one test only you can
      run (I can't create accounts or paste real credentials).
- [ ] Only after the smoke test passes: announce / share the URL.

---

## 2. Auth0 configuration checklist

The app uses the OIDC authorization-code flow (`/login` → Auth0 →
`/auth/callback`), requests scope **`openid email`**, and reads the user's
email from the userinfo endpoint. Any authenticated email is auto-provisioned
its own organization.

- [ ] **Application type:** the Auth0 app is a **Regular Web Application**.
- [ ] **Allowed Callback URLs** include exactly `https://app.fbx1.com/auth/callback`.
- [ ] **Allowed Logout URLs** include exactly `https://app.fbx1.com/logged-out`
      (RP-initiated logout returns here via `/oidc/logout`).
- [ ] **Grant types:** Authorization Code enabled.
- [ ] **Email in token:** the connection returns `email` (the app requires it;
      sign-in fails with a 502 "Identity provider returned no email" otherwise).
- [ ] **OPEN SIGNUP (the switch that launches the beta):** on the database
      connection, **enable "Sign Ups"** (disable "Disable Sign Ups"), and
      **remove the invited-testers gate** — either the connection allowlist or
      the Login/Pre-User-Registration **Action** that currently rejects
      non-invited emails. Keep **email verification ON**.
- [ ] **Attack protection:** turn on Auth0 **Bot Detection** and **Brute-force
      protection** (this is your signup/login abuse defense — the app itself
      has no login rate-limiting because Auth0 owns that surface).
- [ ] Confirm the values in Railway env match this app: `COSTFLOW_OIDC_ISSUER`
      (e.g. `https://YOUR_TENANT.us.auth0.com/`, trailing slash ok),
      `COSTFLOW_OIDC_CLIENT_ID`, `COSTFLOW_OIDC_CLIENT_SECRET`.
- [ ] **Rotate the client secret** if it has ever been shared in plaintext;
      update `COSTFLOW_OIDC_CLIENT_SECRET` in Railway and redeploy.

> To **close the doors again fast** (incident/rollback): re-enable "Disable Sign
> Ups" in Auth0. Existing users keep working; new signups stop immediately. No
> code deploy needed.

---

## 3. Railway configuration checklist

- [ ] Service **costflow** builds from the **Dockerfile** (`railway.json` →
      `build.builder = DOCKERFILE`).
- [ ] `railway.json` deploy config is intact:
      `preDeployCommand = "pnpm --filter @costflow/web migrate"`,
      `startCommand = "pnpm --filter @costflow/web start"`,
      `healthcheckPath = "/healthz"`, `healthcheckTimeout = 60`,
      `restartPolicyType = ON_FAILURE`, `restartPolicyMaxRetries = 3`.
      **Never** change the start command to `migrate && start` — that hangs the
      boot and fails the healthcheck (see §14).
- [ ] Postgres plugin is attached and **`DATABASE_URL` is referenced** by the
      web service (Railway variable reference to the Postgres service).
- [ ] All environment variables from §5 are set on the **costflow** service in
      the **production** environment.
- [ ] Replica count = 1 for v1 (the in-process job runner and the boot-time
      interrupted-job recovery assume a single instance; scaling out is a
      deferred item — §15).
- [ ] Confirm a deploy currently shows **ACTIVE / "Deployment successful"** with
      Build ✓, **pre-deploy migration ✓**, Deploy ✓, Healthcheck ✓.
- [ ] Note where to watch logs: service → **Deploy Logs** (boot + migration) and
      the project **Logs** tab (runtime request/error lines).

---

## 4. DNS / domain checklist

- [ ] `app.fbx1.com` points to the Railway service (Railway custom domain →
      CNAME as Railway instructs).
- [ ] **TLS** certificate is issued and valid (Railway auto-provisions); confirm
      `https://app.fbx1.com` loads with a valid cert and no mixed-content
      warnings.
- [ ] `https://app.fbx1.com/healthz` returns `{"status":"ok"}`.
- [ ] HTTP → HTTPS is enforced (Railway edge). HSTS is set by the app in
      production (`max-age=31536000; includeSubDomains`).
- [ ] Redirect URIs in Auth0 (§2) and `COSTFLOW_OIDC_REDIRECT_URI` (§5) use this
      exact host over https.
- [ ] (Optional, recommended) put **Cloudflare** (or Railway edge rules) in
      front for DDoS / basic rate-limiting — the app has no app-level rate
      limiting by design (§15).

---

## 5. Environment variables checklist

Set on the Railway **costflow** service (production). The app **refuses to boot
with a named error** if a required one is missing or malformed — it never
limps. Never commit any of these; never paste secret values into chat or logs.

| Variable | Required | Value / notes |
|---|---|---|
| `COSTFLOW_ENV` | ✅ | `production` (enables secure cookies, trusted proxy, HSTS, strict validation) |
| `COSTFLOW_AUTH` | ✅ | `oidc` (`dev` is refused in production) |
| `COSTFLOW_SESSION_KEY` | ✅ | base64 of **32 random bytes** — signs session cookies |
| `COSTFLOW_CREDENTIAL_KEY` | ✅ | base64 of **32 random bytes** — AES-256-GCM key for tenant salts + Jira tokens |
| `COSTFLOW_OIDC_ISSUER` | ✅ | e.g. `https://YOUR_TENANT.us.auth0.com/` |
| `COSTFLOW_OIDC_CLIENT_ID` | ✅ | Auth0 application client id |
| `COSTFLOW_OIDC_CLIENT_SECRET` | ✅ | Auth0 application client secret |
| `COSTFLOW_OIDC_REDIRECT_URI` | ✅ | `https://app.fbx1.com/auth/callback` |
| `DATABASE_URL` | ✅ | Railway Postgres reference (never the test DB) |
| `PORT` | platform | set by Railway; app binds `0.0.0.0:$PORT` in production |
| `COSTFLOW_ADMIN_EMAILS` | recommended | comma-separated founder emails for `/admin` (activation funnel). Unset ⇒ `/admin` 404s for everyone |
| `COSTFLOW_PUBLIC_URL` | optional | `https://app.fbx1.com`. If unset, the post-logout URL is derived from the callback origin (same result). Must match an Auth0 Allowed Logout URL origin |
| `COSTFLOW_STORE` | must NOT be `memory` | leave unset in prod; `memory` is refused in production |
| `COSTFLOW_TELEMETRY` | optional | set to `off` to disable the local interaction log; default on (local file only, no transport) |
| `COSTFLOW_TELEMETRY_DIR` | optional | default `.costflow` (container-local, ephemeral — not a data store) |

- [ ] Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- [ ] **Guard the two keys.** `COSTFLOW_CREDENTIAL_KEY` decrypts every tenant's
      Jira token; if it changes, all stored tokens become undecryptable and
      customers must reconnect. `COSTFLOW_SESSION_KEY` change invalidates all
      live sessions (everyone re-logs-in). Rotate deliberately (§9).
- [ ] After any change, redeploy and confirm `/readyz` → 200.

---

## 6. Support mailbox checklist

The address **`support@fbx1.com`** is shown on the landing page, `/terms`, and
`/privacy`, and is the only human contact channel in v1.

- [ ] `support@fbx1.com` exists (or forwards to a monitored inbox you check
      daily during launch).
- [ ] Send a test email to it and confirm it arrives.
- [ ] Decide who answers and the target response time (state it if you like —
      but at minimum, read it daily in week one).
- [ ] (If you change the address, it's a one-line code change in
      `apps/web/src/landing.ts` `SUPPORT_EMAIL` — tell me and I'll ship it.)

---

## 7. Backup / recovery checklist

- [ ] **Railway managed Postgres backups are enabled**; confirm the schedule and
      retention in the Postgres plugin settings.
- [ ] Know how to **restore**: Railway console → Postgres → Backups → restore to
      a point in time / new volume. Practice a restore into a throwaway DB once.
- [ ] **Migrations are additive and idempotent** — an app rollback never needs a
      schema rollback (there are no destructive migrations in v1). A future
      destructive migration must ship with a tested down-migration and a
      pre-migration backup (docs/16 §3–4).
- [ ] **Erasure vs. backups:** customer deletion (workspace or whole org) is
      immediate and cascades in Postgres (FR-22). **Backups are the one place an
      erased row can still exist** until the backup ages out — bound/disclose
      the retention window before you scale, and honor erasure in backups if a
      customer formally requests it (docs/16 §12).
- [ ] There is **no separate copy** of customer runs outside Postgres. The
      container-local interaction telemetry (`.costflow/…`) is not a data store
      and is expendable.

---

## 8. Monitoring & alerting checklist

The app emits **one sanitized JSON log line per request** and structured event
lines; there is no external telemetry transport. Watch these:

- [ ] **Liveness:** external uptime monitor (UptimeRobot / Better Stack / etc.)
      on `https://app.fbx1.com/healthz` (expect `{"status":"ok"}`), 1-min
      interval, alert to your phone/email. This is your "site is down" pager.
- [ ] **Readiness:** monitor `https://app.fbx1.com/readyz` (200 ready, **503**
      when Postgres is unreachable). A 503 here with `/healthz` 200 means the DB
      is down, not the app.
- [ ] **Railway metrics:** watch CPU/memory and the Postgres connection count on
      the service dashboard.
- [ ] **Error signal in logs** (project Logs tab): grep for
      `"msg":"request-error"` (uncaught errors — the message is never logged,
      only the error class name + redacted path). Any spike is worth a look.
- [ ] **Failure signals to know:** `attribution-guard-blocked` (a report was
      withheld because it would name an individual — should be rare/zero),
      `report-render-fallback` (a run.json failed structured render and fell
      back to markdown), `jira-list-projects-failed` / `jira-import-failed`
      (provider/connect issues — expected sometimes; a spike means Jira API or
      token trouble), `logout-attempt` (booleans only, for the deferred D-19).
- [ ] **Activation funnel:** visit `https://app.fbx1.com/admin` (must be signed
      in as a `COSTFLOW_ADMIN_EMAILS` address) to see distinct-org counts for
      signup → connect → analysis → report-viewed. Check daily in week one.
- [ ] Log privacy is enforced in code: no bodies, tokens, emails, titles, actor
      values, invite tokens, or ids reach the logs (paths are redacted). You can
      safely share sanitized log excerpts with support.

---

## 9. Production security checklist (verify — mostly already enforced in code)

- [ ] **HTTPS + HSTS** (prod), **secure + httpOnly + SameSite=Lax** session
      cookie, **trusted proxy** on (Railway edge). All automatic when
      `COSTFLOW_ENV=production`.
- [ ] **Strict CSP** on every response: `default-src 'none'`, `script-src
      'none'` (the app ships zero client JS), `style-src 'self' 'unsafe-inline'`,
      `form-action 'self'`, `frame-ancestors 'none'`; plus `X-Frame-Options:
      DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
      COOP, Permissions-Policy.
- [ ] **CSRF** token required on every state-changing POST (login/logout,
      connect, mapping, assumptions, run, delete, all `/org` actions).
- [ ] **Credentials at rest:** Jira tokens + tenant salts are AES-256-GCM
      encrypted (`COSTFLOW_CREDENTIAL_KEY`); plaintext exists only during
      connection validation and job execution; never rendered or logged.
- [ ] **No caching of authenticated pages:** responses to a signed-in request
      carry `Cache-Control: no-store, private` (financial reports can't be
      recovered via the back button on a shared browser). Public pages stay
      cacheable.
- [ ] **Attribution guard (FR-17):** every report surface withholds the whole
      response if a raw individual identity would appear (ADR-0002).
- [ ] **Authorization:** roles resolved live per request; manager-only routes
      gated; org-erasure owner-only; last-owner protection; member workspace
      scoping; tenant isolation on every store call.
- [ ] **Error boundary:** uncaught errors return a generic response and log only
      the error class name — no DB detail or decrypt message leaks to the client.
- [ ] **Secrets** live only in Railway variables (never in the repo, image, or
      logs). The Docker image contains no secrets.
- [ ] **Credential rotation (deliberate):** Auth0 secret → update env + redeploy;
      `COSTFLOW_SESSION_KEY` → all sessions invalidated; `COSTFLOW_CREDENTIAL_KEY`
      → tenants must reconnect (no bulk re-encryption job yet — debt D-18); a
      tenant's Jira token → the customer revokes in Atlassian and reconnects.
- [ ] (Recommended, edge-level) enable basic rate limiting / DDoS protection at
      Cloudflare or Railway — the app deliberately leaves this to the edge.

---

## 10. Legal checklist

- [ ] **Terms** (`/terms`) and **Privacy** (`/privacy`) are live and linked from
      the landing footer. They are honest, plain-language **beta** documents and
      say so.
- [ ] **Have counsel review** both before you (a) charge money or (b) leave
      beta / go GA. The pages already state this. For a free beta handling work
      data, the current pages are a reasonable good-faith baseline — but they
      are not a substitute for legal advice.
- [ ] Confirm the privacy claims match reality (they do in code): pseudonymized
      individuals, encrypted credentials, tenant isolation, self-service
      deletion/erasure, aggregate-only analytics, no data sold or transmitted
      off-box. Don't claim more than this.
- [ ] If you will onboard EU customers, plan a **Data Processing Addendum** and
      confirm your Railway/Postgres region and Auth0 data residency meet your
      commitments (a GA item; note it now).
- [ ] The demo report uses **synthetic demo data** (no real customer/person).

---

## 11. Go-live checklist (launch day)

Do these in order:

1. [ ] Confirm the latest deploy is **ACTIVE / successful** and `/healthz`,
       `/readyz` are 200.
2. [ ] Confirm all §5 env vars are set (especially `COSTFLOW_ADMIN_EMAILS`).
3. [ ] **Flip the Auth0 switch (§2):** enable sign-ups, remove the invited gate,
       keep email verification + attack protection on.
4. [ ] **Founder smoke test** (only you can do this end-to-end):
       - [ ] Open `https://app.fbx1.com/` in a fresh/incognito browser →
             landing loads, header shows **Sign in** (not app nav).
       - [ ] Open **View a sample report** → the demo renders with figures and
             drill-downs, and a "Get started free" CTA.
       - [ ] **Get started free** → Auth0 → **sign up with a brand-new email** →
             confirm the **verification email arrives** and completes.
       - [ ] Land in the app → **Connect Jira**: use the "How to get your Jira
             API token" help, paste a **real** site/email/token → Validate &
             connect succeeds.
       - [ ] Choose a project → map statuses → map roles → on Assumptions tick
             **"Accept all suggested values"** → **Run CostFlow**.
       - [ ] The **report** renders with priced frictions and formula
             drill-downs; try **Printable / export** (print → Save as PDF).
       - [ ] **Sign out** → you land on `/logged-out`. Open `/connect` again →
             you are asked to sign in (if a normal browser silently re-auths,
             that's the known D-19 item — note it, it's non-blocking).
       - [ ] **Settings → delete this workspace** (type `DELETE`) → the run 404s.
       - [ ] (Optional) create a second throwaway org and **delete the whole
             organization** (type `DELETE ALL DATA`) to confirm erasure.
       - [ ] `/admin` (as a `COSTFLOW_ADMIN_EMAILS` user) shows the funnel with
             your test activity.
5. [ ] If anything above fails, **do not announce** — re-close signups (§2) and
       tell me exactly what failed.
6. [ ] If it all passes: announce / share `https://app.fbx1.com`.

---

## 12. First 24 hours checklist

- [ ] Keep the `/healthz` uptime alert visible; treat any page as P0.
- [ ] Every few hours: skim project Logs for `request-error` spikes and any
      `attribution-guard-blocked` (should be zero).
- [ ] Check `/admin` funnel — are people getting past **connect**? The connect
      step is the known drop-off; if signups aren't connecting, the Jira-token
      step is the suspect.
- [ ] Watch `support@fbx1.com` closely; first users often hit the same snag
      (usually the API token) — a quick reply saves the activation.
- [ ] Watch Railway Postgres connection count and memory; 1 replica is fine for
      early volume but keep an eye on it.
- [ ] Confirm at least one **real end-to-end report** was produced by someone
      other than you.

---

## 13. First week checklist

- [ ] Daily: funnel (`/admin`), error logs, support inbox, uptime.
- [ ] Identify the **biggest activation drop** in the funnel and decide the one
      fix worth making (likely onboarding/connect copy, or the first-report
      value moment).
- [ ] Note the top 3 support themes; if one is a real bug, tell me and I'll fix
      it (this is where the fast-follow backlog comes from).
- [ ] Verify a **Postgres backup exists and restores** (do the throwaway restore
      drill if you didn't pre-launch).
- [ ] Confirm no privacy surprises: spot-check logs contain no tokens/emails/
      titles; confirm `workspaces.token_ciphertext` is ciphertext.
- [ ] Decide the next roadmap step with real data in hand: **multi-provider
      onboarding** (widen the funnel) or **billing** (turn beta into revenue).

---

## 14. Rollback procedure (if launch fails)

Fastest levers first:

1. [ ] **Stop the bleeding without a deploy:** in Auth0, re-enable "Disable Sign
       Ups" (§2). New signups halt immediately; existing users unaffected.
2. [ ] **Roll back the app:** Railway → service costflow → **Deployments** →
       pick the last known-good deployment → **Redeploy / Rollback**. Because
       migrations are additive `if not exists`, an app rollback needs **no**
       schema rollback and never conflicts with the DB.
3. [ ] **If a deploy won't go ACTIVE:** check **Deploy Logs**. Known failure
       mode (already fixed, do not reintroduce): a start command of
       `migrate && start` hangs after migration and fails the healthcheck —
       migration must stay the separate **`preDeployCommand`** and start must be
       start-only (§3). A healthcheck failure with Build ✓/Deploy ✓ = the server
       didn't answer `/healthz` in time.
4. [ ] **If the DB is the problem:** `/readyz` 503 + `/healthz` 200 ⇒ Postgres
       unreachable. Check the Postgres service/plugin; the app sheds traffic
       (503) but stays up and recovers when the DB returns.
5. [ ] **If a secret is wrong:** revert the Railway variable and redeploy. If
       `COSTFLOW_SESSION_KEY` changed, users must re-log-in; if
       `COSTFLOW_CREDENTIAL_KEY` changed, restore the previous value or tenants
       must reconnect Jira.
6. [ ] **Data incident:** restore Postgres from the latest backup (§7); accept
       the RPO of the backup schedule. Communicate via `support@fbx1.com`.
7. [ ] Capture what happened; if it's a code bug, hand me the sanitized logs and
       I'll fix + redeploy.

---

## 15. Known deferred items (intentionally NOT in v1)

These are conscious founder decisions, not oversights. None blocks the free
public beta; each is a fast-follow when the data justifies it.

- **Billing / payments.** Free beta; no checkout, plans, or metering.
- **Team invitations & email delivery.** Single-user organizations are the v1
  norm; the org/roles/invite machinery exists and works (invite links are
  copyable) but there is **no transactional email** yet.
- **Multi-provider onboarding.** Jira only in the product; Monday, Asana, and
  CSV are proven in the engine/SPI but not wired into the web onboarding.
- **D-19 — logout SSO termination.** App-side logout works (session cleared,
  redirect to Auth0 `/oidc/logout` → `/logged-out`); some automated/controlled
  browsers didn't fully terminate the Auth0 session. Deferred unless shown to
  affect normal browsers; the sanitized `logout-attempt` diagnostic is retained
  to investigate.
- **Native PDF export.** The report has a chrome-free **print view** (print →
  Save as PDF); no server-side PDF binary dependency.
- **Persistent "remember me" sessions.** The session cookie is a browser-session
  cookie (no `maxAge`); closing the browser requires re-login. Secure default;
  revisit if it hurts retention.
- **App-level rate limiting / WAF.** Left to the edge (Cloudflare/Railway) and
  to Auth0 attack-protection for auth; no in-app limiter.
- **Horizontal scaling.** 1 replica: the in-process job runner and boot-time
  interrupted-job recovery assume a single instance. Multi-replica needs a
  shared job queue first.
- **Bulk credential-key re-encryption (debt D-18).** Rotating
  `COSTFLOW_CREDENTIAL_KEY` currently requires tenants to reconnect.
- **Multi-run trend charting & scenario/simulation UI (P6).** Trend today is a
  single previous-run comparison; simulation remains a CLI capability.

---

*This pack is the final v1 engineering deliverable. Code is complete and
deployed; everything above is founder-operated. Ping me only for a code change
(e.g., support address, a launch bug, or the next roadmap phase).*
