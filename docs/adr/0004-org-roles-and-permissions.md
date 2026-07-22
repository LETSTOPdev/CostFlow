# ADR-0004 — Organization roles & permission model

**Status**: accepted (P4.4) · **Binds**: FR-21, FR-17, NFR-5, doc 06 tenancy law

## Decision

A **tenant is an organization**. Every user belongs to exactly **one**
organization and holds exactly **one** role: `owner` > `admin` > `member`.

- **owner** — full control, including deleting the organization and managing
  owners. At least one owner always exists (enforced).
- **admin** — manage members, invitations, workspaces, and org settings; may
  invite/assign only `admin` or `member`; may not touch owners or the org
  lifecycle.
- **member** — access only the workspaces they are explicitly granted; no org
  management, no onboarding, no deletion.

**Permission enforcement is centralized, not per-view.** A single Fastify
`preHandler` hook classifies "manager-only" paths (onboarding, `/org*`,
`/settings`, `/workspaces/*`, `/account/delete`) and refuses any valid
non-manager session with 403. Member-visible surfaces (`/`, `/runs`,
`/reports/:id`, auth, logout) are excluded and apply their own membership
filter. Fine-grained rules (owner-only actions, last-owner protection) live in
the individual handlers.

**Roles are resolved live from the store on each request, never trusted from
the session cookie.** The signed session carries only `{userId, tenantId,
csrf}`; the role is looked up per request. A demotion or removal therefore
takes effect immediately — there is no window where a stale cookie grants
revoked authority.

**Invitations are capability tokens.** An invitation carries an opaque random
token; the accept link stashes it in a signed `cf_invite` cookie and it is
honored at sign-in: a matching email with no existing account is provisioned
INTO the inviting org with the invited role; the invitation is marked
`accepted`. Lifecycle updates (revoke/accept) are tenant-scoped; token lookup
is not (the token is the capability). Tokens never appear in logs or telemetry.

**Workspace membership is the member access foundation.** Owners/admins reach
every workspace in the org; members reach only workspaces listed in
`workspace_members`. Runs and reports are filtered accordingly.

## Why

- **One-org-per-user keeps tenancy simple and safe.** The tenancy law (every
  store call scoped by `tenantId`) already isolates orgs; a single membership
  per user means no ambiguous "current org" and no cross-org data-blending
  risk. Multi-org membership is a deliberate future item, not a silent gap.
- **Live role resolution over cookie-embedded roles.** Embedding the role in
  the session would make revocation lazy (effective only after re-login) — a
  security smell for an authorization control. One extra indexed lookup per
  manager request buys immediate revocation.
- **Central gate + local fine-grained checks.** A path-classifying hook makes
  "which routes require management" auditable in one place and impossible to
  forget on a new manager route; owner-only nuances that depend on the target
  (last-owner, owner-vs-admin) stay next to the mutation they guard.
- **Capability-token invites, no email dependency.** CostFlow does not send
  email yet; a copyable invite link is honest and testable. The token is the
  authorization, validated against the DB at accept time.

## Scope & limits

- **No email delivery.** Invite links are surfaced in the UI for the admin to
  share out of band. Automated email is a future item (needs SMTP/provider
  config) and is not faked.
- **One org per email.** An email that already owns/belongs to an org cannot
  join a second via invite; it falls through to its own org and the invite
  stays pending. Documented, not silently dropped.
- **Deletion completeness.** `removeUser`, `deleteWorkspace`, and
  `deleteTenantData` remove `workspace_members`/`invitations` transactionally
  (see ADR-0003), so no membership or invitation outlives its org/workspace.
