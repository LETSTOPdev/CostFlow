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

create table if not exists users (
  id uuid primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null
);
create index if not exists users_tenant on users (tenant_id);

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
