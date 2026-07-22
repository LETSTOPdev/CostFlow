# ADR-0003 — Transactional deletion & erasure guarantees

**Status**: accepted (P4.3, extended P4.4) · **Binds**: FR-22, NFR-6, doc 16 §12

## Decision

Every deletion orchestration path is **all-or-nothing** and **tenant-scoped**.

- **Postgres (`PgStore`).** `deleteWorkspace` and `deleteTenantData` open a
  single connection, `begin`, delete child rows **before** parents in FK order,
  then `commit`; any error triggers `rollback` and the whole operation is a
  no-op. `deleteWorkspace` first checks the workspace belongs to the tenant and
  returns `null` (deleting nothing) for a foreign id. Counts come from
  `rowCount` inside the transaction.
- **Memory (`MemoryStore`).** Each delete method runs to completion with no
  intervening `await`, so under the single-threaded model it is effectively
  atomic — no other operation observes a half-deleted state.
- **Cascade is declared twice.** `schema.sql` sets `on delete cascade` on every
  tenant/workspace FK (covers fresh installs); the `PgStore` methods ALSO
  delete children explicitly in-transaction (covers the already-deployed
  database whose constraints predate the rule). Neither mechanism is relied on
  alone.

Erasure completeness (P4.4 extension): `deleteTenantData` removes runs, jobs,
workspace_members, workspaces, invitations, users, and the tenant row.
`deleteWorkspace` removes that workspace's runs, jobs, and workspace_members
before the workspace. `removeUser` removes the user's workspace_members before
the user. All within one transaction on Postgres.

## Why

- **Erasure must be complete or absent, never partial.** A partial delete under
  GDPR erasure (NFR-6) is the worst outcome — data the user believes is gone
  survives, unreferenced and unaudited. A transaction guarantees the user's
  "delete" either fully happened or fully did not, with a clear result either
  way.
- **Runs are append-only in normal operation.** The ONLY code path that removes
  a run is explicit erasure; there is no UPDATE/partial-delete path to leave
  orphans. Append-only + transactional-erase together mean run history is
  tamper-evident and its removal is deliberate.
- **Tenant scoping is a law, not a filter.** Every delete takes `tenantId`
  first; a foreign id deletes nothing. Cross-tenant erasure is impossible by
  construction, proven by the store contract suite on both adapters.

## Operational note

If managed Postgres backups are enabled, the backup retention window is the one
place an erased row can still exist. That window must be bounded and documented
before broad customer launch (doc 16 §12); it is the single caveat to
"deletion in Postgres is the erasure."
