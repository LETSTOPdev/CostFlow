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

create table if not exists workspaces (
  id uuid primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  provider text not null,
  site text not null,
  email text not null,
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
