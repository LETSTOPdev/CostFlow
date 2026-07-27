-- CostFlow self-serve spine schema (doc 09 P4.1 plan §1).
-- Tenancy law: every tenant-owned table carries tenant_id; all application
-- queries are tenant-scoped. Runs are append-only during normal operation
-- (no UPDATE path exists in the adapter); explicit erasure (FR-22, P4.3) is
-- the only path that removes them. Secrets (provider tokens, tenant salts)
-- are AES-256-GCM ciphertext — never plaintext at rest.
--
-- Deletion (FR-22 / NFR-6): the ON DELETE CASCADE rules below give fresh
-- installs DB-enforced erasure. The PgStore delete methods ALSO delete child
-- rows explicitly, in order, within one transaction — so erasure holds on the
-- already-deployed database whose FKs predate this rule. Both mechanisms are
-- belt-and-suspenders; neither alone is relied upon.

create table if not exists tenants (
  id uuid primary key,
  salt_ciphertext text not null,
  created_at timestamptz not null
);
-- P4.4: organization display name (nullable until set).
alter table tenants add column if not exists name text;

create table if not exists users (
  id uuid primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null
);
create index if not exists users_tenant on users (tenant_id);
-- P4.4: organization role. Existing users predate multi-member orgs and are
-- the org creators, so they backfill to 'owner'.
alter table users add column if not exists role text not null default 'owner';

-- `site`/`email` are legacy Jira-era columns (pre-ADR-0005), superseded by the
-- provider-shaped connection_params jsonb; `project_key`/`project_name` are the
-- legacy column names for the generic scope id/name. Kept (nullable) so the
-- deployed database migrates in place without a rewrite.
create table if not exists workspaces (
  id uuid primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  provider text not null,
  site text,
  email text,
  token_ciphertext text not null,
  project_key text,
  project_name text,
  observed_statuses jsonb not null default '[]',
  observed_actors jsonb not null default '[]',
  status_map jsonb,
  actor_role_map jsonb,
  assumptions jsonb,
  onboarding text not null default 'connected',
  created_at timestamptz not null
);
create index if not exists workspaces_tenant on workspaces (tenant_id);
-- ADR-0005 multi-connector migration (idempotent): relax the Jira-shaped NOT
-- NULLs, add the generic columns, and backfill connection_params from the
-- legacy site/email pair exactly once.
alter table workspaces alter column site drop not null;
alter table workspaces alter column email drop not null;
alter table workspaces add column if not exists connection_params jsonb;
alter table workspaces add column if not exists status_hints jsonb;
update workspaces
  set connection_params = jsonb_build_object('site', coalesce(site, ''), 'email', coalesce(email, ''))
  where connection_params is null and (site is not null or email is not null);

create table if not exists jobs (
  id uuid primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  status text not null,
  error_class text,
  error_message text,
  run_id text,
  created_at timestamptz not null,
  finished_at timestamptz
);
create index if not exists jobs_tenant on jobs (tenant_id);
create index if not exists jobs_workspace on jobs (tenant_id, workspace_id);

create table if not exists runs (
  id text not null,
  tenant_id uuid not null references tenants (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  created_at timestamptz not null,
  run_json text not null,
  report_md text not null,
  telemetry_jsonl text not null,
  viewed_at timestamptz,
  primary key (tenant_id, id)
);
-- A Monitoring Workspace's run history, newest first. This is the access path
-- for the run-over-run trend section, for admin per-workspace activity counts,
-- and for the multi-run comparison and trend series still to come — all of them
-- ask the same question ("the last N analyses of this workspace, in order"), so
-- they share one index. Without it that question is a sequential scan over every
-- run in the table, blobs included.
--
-- Note what is NOT here: no per-run metric columns, no summary table, no config
-- snapshot. run_json is a self-contained artifact (NFR-2) that already embeds
-- its batch, its assumption set, and every pinned engine version, so two runs
-- taken months and one salary change apart remain directly comparable from
-- stored data alone. Comparison and trend analysis are read-side features over
-- rows that already exist; adding them needs no migration, and deferring them
-- loses nothing that cannot be recovered later.
create index if not exists runs_workspace_at on runs (tenant_id, workspace_id, created_at desc);

-- P4.4 organization management.
create table if not exists invitations (
  id uuid primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  email text not null,
  role text not null,
  token text not null unique,
  status text not null default 'pending',
  invited_by uuid references users (id) on delete set null,
  created_at timestamptz not null,
  accepted_at timestamptz
);
create index if not exists invitations_tenant on invitations (tenant_id);
create index if not exists invitations_token on invitations (token);

-- P4.4 workspace membership (multi-workspace foundation). Owners/admins reach
-- every workspace in the org; members reach only the workspaces listed here.
create table if not exists workspace_members (
  tenant_id uuid not null references tenants (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null,
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_tenant on workspace_members (tenant_id);
create index if not exists workspace_members_user on workspace_members (tenant_id, user_id);

-- Admin operations console audit trail. Deliberately carries NO foreign keys:
-- an audit row must survive erasure of the tenant/user it references (that
-- durability is the whole point of an audit log). Never stores secrets or raw
-- customer content — action name, target ids, and a small non-secret detail
-- (e.g. old/new role) only. `admin_email` is the operator (an allowlisted
-- admin), not customer PII.
create table if not exists admin_audit (
  id uuid primary key,
  at timestamptz not null,
  admin_user_id uuid,
  admin_email text not null,
  action text not null,
  target_kind text,
  target_id text,
  target_tenant_id uuid,
  detail jsonb
);
create index if not exists admin_audit_at on admin_audit (at desc);

-- ---------------------------------------------------------------------------
-- Activity spine (P4.5 operations CRM).
--
-- Append-only record of what happened, and who did it. This is the table that
-- makes per-user attribution possible at all: workspaces/jobs/runs carry a
-- tenant_id but no actor, so before this table "which user connected ClickUp"
-- was unanswerable. Interaction telemetry already existed (telemetry-web.ts)
-- but only ever reached a local JSONL file — per-replica and erased by every
-- deploy. Same vocabulary, durable storage.
--
-- This table is the CANONICAL source for product analytics, onboarding funnels,
-- customer timelines, admin insight, and whatever operational intelligence comes
-- next. So it is deliberately generic, and stays that way:
--
--   * `type` is plain text with NO check constraint and NO enum. A new event
--     type is a new string. Postgres enums were rejected precisely because
--     extending one is a migration, and because dropping a value from one is
--     effectively impossible.
--   * `fields` is open jsonb — per-type payloads live there rather than as
--     columns, so no event type ever adds, widens, or nulls a column.
--   * Nothing per-event-type appears anywhere in the schema: no side tables, no
--     partial indexes on specific types. The indexes below are over (tenant,
--     time), (user, time), and (type, time) — shapes that serve every question,
--     including ones about types that do not exist yet.
--
-- The cost of introducing a new event type is therefore one call site. Readers
-- treat unrecognized types as data, not as errors, which also makes rolling
-- deploys safe: the older replica reads rows written by the newer one.
--
-- Privacy: `fields` holds counts, enums, and booleans ONLY (invariant: no
-- emails, titles, tokens, salts, or customer vocabulary). The actor is a user
-- id, resolved to an email at render time from `users` and only for the admin
-- allowlist. tenant_id cascades so GDPR erasure (FR-22) removes activity too.
-- `user_id`/`workspace_id` carry no FK to the subject rows: an event must
-- survive the deletion of the thing it describes (that is the point of a log),
-- and the tenant cascade still guarantees erasure.
create table if not exists events (
  id uuid primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid,
  workspace_id uuid,
  type text not null,
  at timestamptz not null,
  fields jsonb not null default '{}',
  -- Deterministic key for rows derived from pre-existing tables, so the
  -- historical backfill below is idempotent across redeploys. Null for events
  -- written live by the application.
  source_key text
);
create unique index if not exists events_source_key on events (source_key) where source_key is not null;
create index if not exists events_tenant_at on events (tenant_id, at desc);
create index if not exists events_at on events (at desc);
create index if not exists events_user_at on events (user_id, at desc);
create index if not exists events_type_at on events (type, at desc);
create index if not exists events_tenant_type_at on events (tenant_id, type, at desc);

-- Identity attributes observed from the IdP (P4.5). One row per user, so these
-- live on `users` rather than a side table: it is 1:1 with the Auth0 subject,
-- and a join on every admin listing would cost exactly the query performance
-- the console needs. `events` keeps the history; these columns are the O(1)
-- current value (the same denormalization Auth0 and Clerk expose).
--
-- Only values the IdP actually provides are stored. `email_verified` is the
-- userinfo claim; `auth_provider` is the connection prefix of the `sub` claim
-- ('google-oauth2', 'auth0', …) and never the full subject identifier.
alter table users add column if not exists email_verified boolean;
alter table users add column if not exists auth_provider text;
alter table users add column if not exists display_name text;
alter table users add column if not exists first_seen_at timestamptz;
alter table users add column if not exists last_seen_at timestamptz;
alter table users add column if not exists sign_in_count integer not null default 0;

-- Backfill for users who predate the identity columns. Every user row is
-- created BY a sign-in (both createTenantWithUser and createUserInTenant run
-- from the auth path), so created_at is a true observed sign-in and a count of
-- 1 is a correct lower bound. email_verified/auth_provider stay null: unknown
-- is honest, and the next sign-in fills them in.
update users
  set first_seen_at = created_at,
      last_seen_at = created_at,
      sign_in_count = 1
  where first_seen_at is null;

-- Billing (P4.5). CostFlow is free during beta and has no billing provider
-- wired; this table exists so that stays TRUE and legible rather than absent.
-- Shaped for Lemon Squeezy so integration is a write path, not a migration:
-- provider_customer_id / provider_subscription_id / provider_variant_id map to
-- LS customer, subscription, and variant (the variant IS the plan), and the
-- date columns map to LS renews_at / ends_at / trial_ends_at. Until then every
-- organization is plan 'beta', billing_status 'free_beta', provider 'none' —
-- no invented trials, no invented payment history.
create table if not exists subscriptions (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  plan text not null default 'beta',
  billing_status text not null default 'free_beta',
  provider text not null default 'none',
  provider_customer_id text,
  provider_subscription_id text,
  provider_variant_id text,
  trial_ends_at timestamptz,
  renews_at timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index if not exists subscriptions_status on subscriptions (billing_status);

-- Every existing organization gets its (accurate) free-beta row.
insert into subscriptions (tenant_id, created_at, updated_at)
  select t.id, t.created_at, t.created_at from tenants t
  on conflict (tenant_id) do nothing;

-- Monitoring Workspace display name (P4.5). A workspace already IS a persistent
-- operational view — connected integration, selected scope, salary assumptions,
-- members, and its full run history — it simply had no name of its own. This is
-- what turns "a Jira connection" into "Engineering".
alter table workspaces add column if not exists name text;

-- ---------------------------------------------------------------------------
-- Historical backfill of the activity spine.
--
-- Derived ONLY from timestamps that already exist. Nothing is inferred: there
-- is no stored history for the middle onboarding milestones (scope selected,
-- statuses mapped, actors mapped, assumptions set), so no event is invented for
-- them — the funnel reads those steps from current workspace state instead, and
-- reports their timing as unavailable rather than guessing. Idempotent via
-- source_key.
insert into events (id, tenant_id, user_id, workspace_id, type, at, fields, source_key)
  select md5('org.created:' || t.id)::uuid, t.id, null, null, 'org.created', t.created_at, '{"backfilled":true}'::jsonb,
         'org.created:' || t.id
    from tenants t
  on conflict (id) do nothing;

insert into events (id, tenant_id, user_id, workspace_id, type, at, fields, source_key)
  select md5('user.created:' || u.id)::uuid, u.tenant_id, u.id, null, 'user.created', u.created_at,
         jsonb_build_object('backfilled', true, 'role', u.role),
         'user.created:' || u.id
    from users u
  on conflict (id) do nothing;

insert into events (id, tenant_id, user_id, workspace_id, type, at, fields, source_key)
  select md5('workspace.connected:' || w.id)::uuid, w.tenant_id, null, w.id, 'workspace.connected', w.created_at,
         jsonb_build_object('backfilled', true, 'provider', w.provider),
         'workspace.connected:' || w.id
    from workspaces w
  on conflict (id) do nothing;

insert into events (id, tenant_id, user_id, workspace_id, type, at, fields, source_key)
  select md5('import.finished:' || j.id)::uuid, j.tenant_id, null, j.workspace_id, 'import.finished',
         coalesce(j.finished_at, j.created_at),
         jsonb_build_object('backfilled', true, 'status', j.status,
                            'errorClass', coalesce(j.error_class, 'none')),
         'import.finished:' || j.id
    from jobs j where j.finished_at is not null
  on conflict (id) do nothing;

insert into events (id, tenant_id, user_id, workspace_id, type, at, fields, source_key)
  select md5('analysis.completed:' || r.tenant_id || ':' || r.id)::uuid, r.tenant_id, null, r.workspace_id, 'analysis.completed', r.created_at,
         '{"backfilled":true}'::jsonb,
         'analysis.completed:' || r.tenant_id || ':' || r.id
    from runs r
  on conflict (id) do nothing;

insert into events (id, tenant_id, user_id, workspace_id, type, at, fields, source_key)
  select md5('report.viewed:' || r.tenant_id || ':' || r.id)::uuid, r.tenant_id, null, r.workspace_id, 'report.viewed', r.viewed_at,
         '{"backfilled":true,"firstView":true}'::jsonb,
         'report.viewed:' || r.tenant_id || ':' || r.id
    from runs r where r.viewed_at is not null
  on conflict (id) do nothing;

insert into events (id, tenant_id, user_id, workspace_id, type, at, fields, source_key)
  select md5('member.invited:' || i.id)::uuid, i.tenant_id, i.invited_by, null, 'member.invited', i.created_at,
         jsonb_build_object('backfilled', true, 'role', i.role),
         'member.invited:' || i.id
    from invitations i
  on conflict (id) do nothing;

insert into events (id, tenant_id, user_id, workspace_id, type, at, fields, source_key)
  select md5('member.joined:' || i.id)::uuid, i.tenant_id, null, null, 'member.joined', i.accepted_at,
         jsonb_build_object('backfilled', true, 'role', i.role),
         'member.joined:' || i.id
    from invitations i where i.accepted_at is not null
  on conflict (id) do nothing;
