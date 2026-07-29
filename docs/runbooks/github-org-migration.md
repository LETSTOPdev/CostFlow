# Runbook — moving CostFlow to a business-owned GitHub organization

**Status: not started. Production is untouched until this is intentionally
scheduled.**

Delete this file once the migration is complete and `08-admin.md` describes the
new arrangement. It is a one-time procedure, not a living document.

---

## Why

`LETSTOPdev/CostFlow` is owned by a personal GitHub account belonging to one
individual (display name "Almog"). That single fact causes every symptom
recorded in `06-known-risks.md` R13, and one much larger risk that has nothing
to do with deployment: **if that account is lost, disabled, or the person
leaves, the business has no path to regain administrative control of its own
production repository.** Nobody else can grant it.

A GitHub App installed on a *personal* account is installable and visible only
to that account's owner — collaborator access, even write, confers nothing.
That is why the Vercel App cannot be made to see this repository from the
`ddoorr1185-ctrl` identity, and why two attempts to fix it from that side
failed. On an organization, installing apps is a **role** that several people
can hold, so the problem becomes structurally impossible rather than repeatedly
worked around.

## What this migration does NOT change

Stating this first, because it is what makes zero downtime achievable:

- **No hostname changes.** `fbx1.com`, `www.fbx1.com` and `app.fbx1.com` keep
  pointing where they point now.
- **No DNS record changes** — as long as the Railway *service* is re-pointed
  rather than recreated (see the warning in Phase 4).
- **Nothing in Auth0 changes.** Auth0 is keyed to `app.fbx1.com` URLs and a
  client id/secret. Repository ownership is invisible to it.
- **No database migration.** The Postgres instance is not touched.
- **No running process is interrupted.** Repository ownership has no bearing on
  a container that is already running or a CDN already serving files.

The only thing that stops working, briefly, is the *deploy pipeline*. That is
not downtime. It is why Phase 0 declares a freeze.

---

## Verified platform constraints

Checked against Vercel's current documentation rather than recalled. Quoted so a
future reader can tell what was verified from what was assumed, and re-check it.

**1. A Hobby team cannot connect an organization-owned repository.**
[`/docs/limits`](https://vercel.com/docs/limits), § *Connecting a project to a
Git repository*, last updated 2026-07-01:

> "Vercel does not support connecting a project on your Hobby team to Git
> repositories owned by Git organizations. You can either switch to an existing
> Team or create a new one."
>
> "The same limitation applies in the Project creation flow when importing an
> existing Git repository or when cloning a Vercel template to a new Git
> repository as part of your Git organization."

What is gated is the **built-in Git integration** — the connected repository
that installs a webhook and gives automatic deployments on push, preview URLs
with pull-request comments, commit statuses, and instant rollback to a previous
commit. Not deployment itself. See constraint 3.

**2. The diagnosis in R13 is Vercel's own documented behaviour, not an
inference.** [`/docs/git/vercel-for-github`](https://vercel.com/docs/git/vercel-for-github),
§ *Missing Git repository → Personal account repositories*:

> "To import or connect a GitHub repository owned by a personal account, you
> must be the repository **Owner**. This allows Vercel to configure a webhook
> and automatically deploy your commits. A Collaborator on a personal repository
> cannot create new Vercel projects from that repository or connect it to
> existing projects."

That is exactly this situation: `ddoorr1185-ctrl` is a Collaborator on a
repository owned by a personal account. No amount of reconfiguring changes it.
This constraint is the reason the migration exists.

**3. There IS a supported way to deploy without upgrading — but not to
*connect*.** Same page, § *Using GitHub Actions*:

> "You can use GitHub Actions to build and deploy your Vercel Application. This
> approach is necessary to enable Vercel with GitHub Enterprise Server (GHES)
> with Vercel, as GHES cannot use Vercel's built-in Git integration."

Vercel documents `vercel build` + `vercel deploy --prebuilt` from Actions as the
supported path wherever the built-in integration cannot be used. That is exactly
what `.github/workflows/deploy-marketing.yml` does. It deploys production and
previews on a Hobby team, from an organization-owned repository, without
violating anything.

What it does not give you: the webhook-driven connection, Vercel-authored
preview comments on pull requests, commit statuses, `repository_dispatch`
events, and one-click rollback to a specific commit. Previews still exist —
the workflow creates them — they are simply built by CI rather than by Vercel.

**4. Pro is required anyway, for a reason that has nothing to do with
organizations.** [`/docs/limits/fair-use-guidelines`](https://vercel.com/docs/limits/fair-use-guidelines),
§ *Commercial usage*, last updated 2026-06-16:

> "**Hobby teams** are restricted to non-commercial personal use only. All
> commercial usage of the platform requires either a Pro or Enterprise plan."
>
> "Commercial usage is defined as any Deployment that is used for the purpose of
> financial gain of **anyone** involved in **any part of the production** of the
> project, including a paid employee or consultant writing the code. Examples of
> this include, but are not limited to … Advertising the sale of a product or
> service."

CostFlow meets that definition twice over: `fbx1.com` advertises a product with
published pricing tiers, and anyone paid to write the code triggers it on its
own. The definition attaches to the **Deployment**, so it does not matter which
mechanism produced it — the GitHub Actions route does not avoid this, and the
same page notes that "circumventing or otherwise misusing Vercel's limits or
usage guidelines is a violation".

**Conclusion.** The runbook's instruction to upgrade before transferring stands,
but the reason is now stated correctly:

- Pro is **not** strictly required to *deploy* an organization-owned repository.
  Constraint 3 is a documented, supported alternative and is already in place.
- Pro **is** required to *connect* one, which is the arrangement this migration
  is aiming for (constraint 1).
- Pro **is** required for CostFlow regardless of any of the above, because it is
  a commercial product (constraint 4). This reason does not disappear if the
  connection question is solved another way, and it applies today, on the
  current Hobby team.

If the plan change has to be deferred, the migration can still proceed: transfer
the repository and keep deploying through the workflow. Phase 5 then becomes
"upgrade, connect, delete the workflow" and can happen later — **but the
commercial-usage exposure in constraint 4 exists now and is not created or
removed by this migration.**

---

## Who must do what

Four roles. Most steps cannot be delegated, and the reason is documented rather
than incidental — see *Verified platform constraints* above.

| Role | Who | Needed for |
|---|---|---|
| **Repository owner** | `LETSTOPdev` (Almog) | 🔑 Every GitHub step in Phases 2–3 |
| **Organization owner** | whoever creates the org | 🔑 App installs, member management |
| **Vercel team owner** | `ddoorr1185@gmail.com` | 🔑 Plan change (billing), project settings |
| **Railway account owner** | current Railway account | 🔑 App install, service source change |

🔑 marks every operation below that requires owner-level permission and cannot
be performed by an agent, a collaborator, or an API token held elsewhere.

---

## Before you start — irreplaceable secrets

**Read this section even if you read nothing else.**

Two environment variables on the Railway service are not recoverable if lost.
Nothing in this migration should touch them, but the failure mode of a mistake
is severe enough to record before beginning.

| Variable | If lost |
|---|---|
| `COSTFLOW_CREDENTIAL_KEY` | **Unrecoverable data loss.** Every stored connector token and every tenant salt is AES-256-GCM encrypted with it. Losing it means every customer must reconnect their tracker, and the pseudonymization salts are gone — so pseudonyms change and run-over-run continuity breaks for every existing customer. |
| `COSTFLOW_SESSION_KEY` | Every signed-in session is invalidated. Disruptive, not destructive: everyone signs in again. |
| `DATABASE_URL` | Points at the production Postgres. **Never recreate the Railway project** — recreate the service at most, and only if unavoidable. |

Before Phase 1, export the full variable set from Railway and store it in the
password manager. The complete list the application reads:

```
COSTFLOW_ENV COSTFLOW_AUTH COSTFLOW_SESSION_KEY COSTFLOW_CREDENTIAL_KEY
COSTFLOW_OIDC_ISSUER COSTFLOW_OIDC_CLIENT_ID COSTFLOW_OIDC_CLIENT_SECRET
COSTFLOW_OIDC_REDIRECT_URI COSTFLOW_PUBLIC_URL COSTFLOW_ADMIN_EMAILS
COSTFLOW_MAX_ISSUES COSTFLOW_MAX_SCOPES COSTFLOW_STORE COSTFLOW_MARKETING_URL
DATABASE_URL
```

🔑 Railway account owner.

**Verification.** The export contains `COSTFLOW_CREDENTIAL_KEY` and
`COSTFLOW_SESSION_KEY`, both decode to exactly 32 bytes:

```bash
echo -n "<value>" | base64 -d | wc -c    # must print 32, twice
```

---

## Current state, for comparison after each phase

Record these before starting; every verification below compares against them.

```bash
curl -s https://app.fbx1.com/healthz                  # {"status":"ok","commit":"<sha>"}
curl -s https://app.fbx1.com/readyz                   # {"status":"ready"}
curl -sI https://fbx1.com/pricing | head -1           # 200
curl -sI https://www.fbx1.com/ | grep -i location     # https://fbx1.com/
curl -sI https://app.fbx1.com/pricing | grep -i location   # https://fbx1.com/pricing
dig +short fbx1.com A                                 # 216.198.79.1
dig +short www.fbx1.com                               # 7a8540b873b95166.vercel-dns-017.com.
dig +short app.fbx1.com                               # lklcoo55.up.railway.app.
```

| Thing | Value today |
|---|---|
| Repository | `LETSTOPdev/CostFlow` (public) |
| Railway | service deploying from that repo, 2 replicas, Postgres attached |
| Vercel team | `dors-projects-ceb7e8c1`, **Hobby**, owner `ddoorr1185@gmail.com` |
| Vercel project | `costflow-marketing` — `prj_dQRXThNiebDT6dqkcCp1pJUYBj5P` |
| Vercel link | **none** (deliberately unlinked) |
| Vercel owner guard | ignored-build-step refuses builds whose `VERCEL_GIT_REPO_OWNER` ≠ `LETSTOPdev` |
| Auth0 | tenant `dev-0l6ne8ms0d1s30aw.us.auth0.com`, client `5kzV6GzJzMLcmhUVhPzMlQdxBnSC0AjV` |

---

## Phase 0 — Freeze

**Why first.** Between the repository transfer and the Railway re-point, nothing
can deploy. If a change is waiting to ship during that window, someone will be
tempted to force it through a half-migrated pipeline.

1. Announce a deploy freeze. No pushes to `main` until Phase 6 passes.
2. Confirm `main` is deployed and nothing is in flight:

```bash
git fetch origin && git log --oneline origin/main -1
curl -s https://app.fbx1.com/healthz          # commit must equal origin/main
```

3. Confirm the marketing site matches `origin/main` too — if the last manual
   deploy predates the newest commit, deploy now, before the freeze:

```bash
pnpm --filter @costflow/marketing build && vercel deploy --prebuilt --prod --yes
```

**Verification.** `/healthz` commit == `origin/main` HEAD, and `fbx1.com` serves
the current content.

**Rollback.** None needed; nothing has changed.

---

## Phase 1 — Create the organization

🔑 Whoever will own it. Do this before touching anything else; it is inert.

1. Create a GitHub organization — suggested name `fbx1`, matching the product
   domain. Free plan is sufficient.
2. **Add at least two owners.** This is the entire point of the migration; an
   organization with one owner reproduces the problem it was created to solve.
3. Invite `LETSTOPdev` and `ddoorr1185-ctrl` as **Members** — not Outside
   Collaborators. `LETSTOPdev` must be an **Owner** to perform the transfer in
   Phase 2, and whoever will connect Vercel in Phase 5 must be an Owner or a
   Member (Vercel cannot connect a repository for an Outside Collaborator).

**Verification.**

```bash
gh api orgs/fbx1 --jq '{login,type}'                     # {"login":"fbx1","type":"Organization"}
gh api orgs/fbx1/members --jq '.[].login'                # both accounts listed
```

Confirm in Settings → People that **two or more** accounts hold the Owner role.

**Rollback.** Delete the organization. Nothing else is affected.

---

## Phase 2 — Transfer the repository

🔑 **`LETSTOPdev` (Almog) only.** No one else can initiate this, including any
organization owner, and no API token held by anyone else will work.

GitHub → `LETSTOPdev/CostFlow` → Settings → General → Danger Zone → **Transfer
ownership** → new owner `fbx1`.

What carries over: all git history and branches, issues, pull requests, wiki,
stars, watchers, and **permanent redirects** from the old URL — so existing
clones keep fetching and pushing without immediate changes.

What does **not** reliably carry over, and must be checked in Phase 3: Actions
secrets, branch protection rules, and any repository-level webhooks.

**Verification.**

```bash
gh api repos/fbx1/CostFlow --jq '{full_name,owner:.owner.login,type:.owner.type,private}'
# full_name fbx1/CostFlow, owner.type Organization

git ls-remote https://github.com/LETSTOPdev/CostFlow.git HEAD   # redirect still resolves
gh api repos/fbx1/CostFlow/commits/main --jq .sha               # equals the pre-transfer sha
```

Then update the local remote on every machine that has a clone:

```bash
git remote set-url origin https://github.com/fbx1/CostFlow.git
git remote -v && git fetch origin
```

**Rollback.** An organization owner transfers the repository back to
`LETSTOPdev`. Redirects are recreated in the other direction. History is never
at risk in either direction.

---

## Phase 3 — Repair what the transfer dropped

1. **Convert Outside Collaborators to Members.** This is the step most likely to
   stall the migration on the day, and it is created *by* the transfer:
   collaborators on the old personal repository arrive in the organization as
   **Outside Collaborators**, and Vercel documents that an Outside Collaborator
   cannot connect a repository at all —

   > "If you have access to the repository but are only an Outside Collaborator
   > in the GitHub organization, you cannot import or connect a GitHub
   > repository in Vercel. You need to be an Owner or a Member of the GitHub
   > organization."
   > — [`/docs/git/vercel-for-github`](https://vercel.com/docs/git/vercel-for-github)

   🔑 Organization owner. In the org's **People** tab, invite each Outside
   Collaborator as a **Member**, then grant repository access through a team or
   directly. Whoever will perform the Vercel link in Phase 5 must be an
   organization **Owner or Member** with access to the repository — not an
   Outside Collaborator.

```bash
gh api orgs/fbx1/members --jq '.[].login'                    # must include whoever links Vercel
gh api orgs/fbx1/outside_collaborators --jq '.[].login'      # should NOT include them
```

2. Compare secrets against the pre-transfer list:

```bash
gh api repos/fbx1/CostFlow/actions/secrets --jq '.secrets[].name'
```

At the time of writing the repository has **no** secrets, so there should be
nothing to restore. If `VERCEL_TOKEN` was added in the interim, re-add it.

3. Re-apply branch protection on `main`, if any was configured.
4. Confirm CI still runs:

```bash
gh workflow list --repo fbx1/CostFlow
gh run list --repo fbx1/CostFlow --limit 3
```

**Verification.** `gh run list` shows both `CI` and `Deploy marketing site`
present, and the most recent run's conclusion is not `failure` for a reason
introduced by the transfer. `gh api orgs/fbx1/outside_collaborators` does not
list anyone who needs to connect Vercel.

**Rollback.** None required — this phase only restores settings.

---

## Phase 4 — Railway

🔑 Railway account owner.

> ⛔ **Do not delete or recreate the Railway service, and never the project.**
> Recreating the service issues a new `*.up.railway.app` hostname, which
> invalidates the `app` CNAME and, through it, every Auth0 callback. Recreating
> the *project* can destroy the Postgres instance. The only change needed here
> is the source repository of the existing service.

1. Install the Railway GitHub App on the `fbx1` organization and grant it
   `fbx1/CostFlow`.
2. In the existing service → Settings → Source, change the connected repository
   to `fbx1/CostFlow`, branch `main`. Leave the build, the pre-deploy migration
   command, the healthcheck path, replica count and **every environment
   variable** exactly as they are.
3. Confirm the variables survived the change, in particular
   `COSTFLOW_CREDENTIAL_KEY` and `COSTFLOW_SESSION_KEY`.

**Verification.** Do not test with a real change. Push an empty commit and watch
it deploy:

```bash
git commit --allow-empty -m "chore: verify the Railway source after the transfer"
git push origin main
# wait for the deploy, then:
curl -s https://app.fbx1.com/healthz        # commit == the empty commit's sha
curl -s https://app.fbx1.com/readyz         # {"status":"ready"} — the database is still attached
dig +short app.fbx1.com                     # STILL lklcoo55.up.railway.app.
```

Then confirm authentication is intact end to end, because this is the phase that
could break it without appearing to:

```bash
curl -sI https://app.fbx1.com/login | grep -i location
# → the Auth0 authorize URL, with redirect_uri=https%3A%2F%2Fapp.fbx1.com%2Fauth%2Fcallback
```

Sign in with a real account, open a report, sign out.

**Rollback.** Re-point the service's source back to `LETSTOPdev/CostFlow`
(possible only while the redirect exists, i.e. before the old name is reused).
If the service will not deploy at all, Railway can redeploy the last successful
build from its deployment history — the running replicas are unaffected
throughout, so this is a pipeline rollback, not a service rollback.

---

## Phase 5 — Vercel

🔑 Vercel team owner. Billing action in step 1.

1. **Upgrade the team to Pro.** 🔑 Vercel team owner; billing action.

   Two independent reasons, both verified against the documentation quoted in
   *Verified platform constraints* above:

   - A Hobby team cannot **connect** an organization-owned repository, which is
     the arrangement this phase exists to create.
   - Hobby is restricted to non-commercial personal use, and CostFlow does not
     qualify. This reason stands on its own and applies to the team *today*.

   If the plan change must wait, **stop after step 1 and leave the workflow in
   place** — it deploys an organization-owned repository on Hobby by a
   documented, supported route. Resume at step 2 when the plan changes. Do not
   attempt to connect the repository on Hobby; it will not work.
2. Install the Vercel GitHub App on the `fbx1` organization, granting it
   `fbx1/CostFlow`.
3. Link the project — **by full name, never by bare repository name:**

```bash
vercel git connect https://github.com/fbx1/CostFlow
```

4. **Verify the link before anything else.** This is the step that has already
   gone wrong once: linking by bare name bound the project to
   `ddoorr1185-ctrl/costflow`, a stale private copy predating the host split.

```bash
vercel project ls
# or, definitively:
curl -s "https://api.vercel.com/v9/projects/prj_dQRXThNiebDT6dqkcCp1pJUYBj5P?teamId=team_nwQLrPSqFC4sl4W2kzHHFwOp" \
  -H "Authorization: Bearer $VERCEL_TOKEN" | python3 -c \
  "import sys,json;print(json.load(sys.stdin)['link'])"
# link.org MUST read "fbx1". If it reads anything else, unlink immediately.
```

5. Confirm the build settings survived: build command
   `pnpm --filter @costflow/marketing build`, install command
   `pnpm install --frozen-lockfile`, root directory empty, Node 22.x.

**Verification.** Push a trivial marketing-visible change and watch it deploy
from git rather than by hand:

```bash
git push origin main
# Vercel dashboard shows a deployment with source "git", not "cli"
curl -sI https://fbx1.com/pricing | head -1        # 200
curl -s https://fbx1.com/sitemap.xml | grep -c fbx1.com
```

Open a pull request and confirm it produces a **preview** deployment at its own
URL, and that `fbx1.com` is unchanged while it exists.

**Rollback.** Unlink the project. `fbx1.com` keeps serving its last deployment
regardless — an unlinked project does not stop serving — and the manual
`--prebuilt` deploy in `08-admin.md` remains available. Downgrading the plan is
a separate decision and is not required to roll back the link.

---

## Phase 6 — Remove the scaffolding

Only after Phase 5 verification passes, in this order.

1. **Delete `.github/workflows/deploy-marketing.yml`.** With the App connected,
   leaving it would deploy `fbx1.com` twice on every push.
2. **Remove the Vercel owner guard.** It refers to `LETSTOPdev` and would now
   block every legitimate build:

```bash
curl -s -X PATCH "https://api.vercel.com/v9/projects/prj_dQRXThNiebDT6dqkcCp1pJUYBj5P?teamId=team_nwQLrPSqFC4sl4W2kzHHFwOp" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"commandForIgnoringBuildStep":null}'
```

> Do these two together. Removing the guard while the workflow still exists is
> harmless; deleting the workflow while the guard still names `LETSTOPdev` means
> **nothing** deploys the marketing site, and the failure is silent — the build
> is skipped, not failed.

3. Delete `R13` from `06-known-risks.md` (resolved risks are deleted, not
   annotated).
4. Update `08-admin.md`: repository URL, the "deploying by hand" section, and
   the connection instructions.
5. Update this file out of existence — delete it.

**Verification.**

```bash
git push origin main    # a trivial docs change
```

Both Railway and Vercel deploy, exactly once each. Then re-run the full
production sweep in the next section.

---

## Phase 7 — Full production verification

The same sweep used for the original host split. Every line must pass.

```bash
# hosts
curl -sI https://fbx1.com/pricing | head -1                  # 200
curl -sI https://app.fbx1.com/pricing | grep -i location     # https://fbx1.com/pricing
curl -sI https://fbx1.com/dashboard | grep -i location       # https://app.fbx1.com/dashboard
curl -sI https://www.fbx1.com/docs | grep -i location        # https://fbx1.com/docs
curl -sI https://fbx1.com/nothing-here | head -1             # 404
curl -sI https://fbx1.com/ https://app.fbx1.com/ | grep -c 301   # 0 — the root never moves

# SEO
curl -s https://fbx1.com/robots.txt | grep Sitemap           # one sitemap, on the public host
curl -s https://app.fbx1.com/robots.txt | grep -c Sitemap    # 0
curl -s https://fbx1.com/sitemap.xml | grep -c app.fbx1.com  # 0

# application
curl -s https://app.fbx1.com/healthz                         # commit == origin/main
curl -s https://app.fbx1.com/readyz                          # {"status":"ready"}
curl -sI https://app.fbx1.com/login | grep -i location       # Auth0, redirect_uri app.fbx1.com

# DNS unchanged
dig +short fbx1.com A                                        # 216.198.79.1
dig +short www.fbx1.com                                      # 7a8540b873b95166.vercel-dns-017.com.
dig +short app.fbx1.com                                      # lklcoo55.up.railway.app.
```

Then walk the product: sign in, connect a tracker, run an analysis, open the
report, sign out. Authentication is the flow whose breakage would be worst and
the one least likely to be caught by a probe.

---

## Auth0 — what to check, and why nothing should change

Auth0 has no knowledge of GitHub. It is included here only because it is the
subsystem most likely to be broken *accidentally*, by a change made elsewhere.

Nothing in this migration should require an Auth0 edit. Confirm, in the Auth0
dashboard, that the application still holds exactly:

- **Allowed Callback URLs** — `https://app.fbx1.com/auth/callback`
- **Allowed Logout URLs** — `https://app.fbx1.com/logged-out`
- **Allowed Web Origins** — `https://app.fbx1.com`

These break only if `app.fbx1.com` stops resolving to the application — which
happens only if the Railway service is recreated and the CNAME target changes.
That is the failure this runbook forbids in Phase 4, and it is the single reason
Auth0 appears in it at all.

Do **not** rotate the client secret during the migration. It is one more thing
that can fail, and nothing about a repository transfer requires it.

---

## DNS — what changes

**Nothing.** All three records stay exactly as they are, and no registrar login
is needed at any point in this migration.

| Record | Host | Value | Touched? |
|---|---|---|---|
| `A` | `@` | `216.198.79.1` | no |
| `CNAME` | `www` | `7a8540b873b95166.vercel-dns-017.com.` | no |
| `CNAME` | `app` | `lklcoo55.up.railway.app.` | no |

The one scenario that would force a DNS change is recreating the Railway
service, which issues a new `*.up.railway.app` hostname. Phase 4 exists to
prevent that. If it happens anyway: update the `app` CNAME to the new target at
Namecheap 🔑, wait for propagation, and re-verify Auth0 sign-in — the
certificate reissues automatically, but sign-in is broken until the record
resolves.

---

## Rollback summary

Each phase reverses independently. Nothing here is one-way.

| Phase | Rollback | Customer impact of rolling back |
|---|---|---|
| 1 Organization | Delete the org | none |
| 2 Repository transfer | 🔑 Org owner transfers it back to `LETSTOPdev` | none — redirects both ways |
| 3 Settings repair | Re-apply the previous settings | none |
| 4 Railway source | Re-point to the old repo, or redeploy the last good build from history | none — running replicas are never stopped |
| 5 Vercel link | Unlink; deploy by hand as before | none — the CDN keeps serving |
| 6 Scaffolding removal | Restore the workflow file and re-set the guard | none |

**The whole migration** rolls back by transferring the repository back and
re-pointing Railway and Vercel at it. The application never stops serving at any
point in either direction, because at no stage is a running service, a
hostname, or a database modified.

---

## Why this achieves zero downtime

Worth stating plainly so nobody schedules a maintenance window that is not
needed:

- A running Railway container does not consult GitHub. Transferring the
  repository cannot interrupt it.
- The Vercel CDN serves its last deployment whether or not a repository is
  linked.
- No hostname, certificate, DNS record, database or Auth0 setting is modified.

What is genuinely interrupted is the ability to **ship a change**, from the
moment of transfer until Phases 4 and 5 verify. That window is the reason for
the Phase 0 freeze, and it should be measured in hours, not days — an
unfinished migration leaves the deploy pipeline half-connected, which is a worse
state to sit in than either end.
