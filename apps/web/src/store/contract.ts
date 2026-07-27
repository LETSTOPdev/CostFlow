import type { AssumptionSet, StageKind } from '@costflow/domain';

/**
 * Persistence contract for the self-serve spine (doc 09 P4.1 plan §1).
 * Tenancy law: every method that touches tenant-owned rows takes tenantId
 * FIRST and scopes by it — a foreign id resolves to null/not-found, never to
 * another tenant's row. Runs are append-only. Two implementations: memory
 * (tests/dev) and Postgres (production; contract-tested when a database URL
 * is available).
 */

/**
 * Organization roles (P4.4). A tenant IS an organization; every user holds
 * exactly one role in exactly one organization. owner > admin > member.
 *  - owner: full control, incl. delete-org and managing admins;
 *  - admin: manage members/invitations/workspaces/org settings;
 *  - member: access only the workspaces they belong to; no org management.
 */
export type OrgRole = 'owner' | 'admin' | 'member';

export const ORG_ROLES: readonly OrgRole[] = ['owner', 'admin', 'member'];

export interface TenantRecord {
  readonly id: string;
  /** Organization display name; null until the owner sets one. */
  readonly name: string | null;
  readonly saltCiphertext: string;
  readonly createdAt: string;
}

export interface UserRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: OrgRole;
  readonly createdAt: string;
  /** Identity attributes observed from the IdP (P4.5); null until first seen. */
  readonly identity: UserIdentity;
}

/**
 * Authentication attributes as reported by the identity provider (P4.5), plus
 * the sign-in activity CostFlow itself observes. Nothing here is inferred: a
 * claim the IdP does not send stays null rather than being guessed at.
 *
 * Stored on `users` (1:1 with the IdP subject) so admin listings need no join.
 * `events` remains the history of record; these are the O(1) current values.
 */
export interface UserIdentity {
  /** The IdP's `email_verified` claim. Null when never observed. */
  readonly emailVerified: boolean | null;
  /** Connection prefix of the `sub` claim ('google-oauth2', 'auth0', …) — never the full subject id. */
  readonly authProvider: string | null;
  /** The IdP's `name` claim. Null when the IdP does not send one. */
  readonly displayName: string | null;
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
  readonly signInCount: number;
}

/** Identity attributes to record at sign-in. Absent keys are left untouched. */
export interface IdentityObservation {
  readonly emailVerified?: boolean;
  readonly authProvider?: string;
  readonly displayName?: string;
}

export const UNKNOWN_IDENTITY: UserIdentity = {
  emailVerified: null,
  authProvider: null,
  displayName: null,
  firstSeenAt: null,
  lastSeenAt: null,
  signInCount: 0,
};

export interface InvitationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: OrgRole;
  /** Opaque capability token carried in the accept link (never logged). */
  readonly token: string;
  readonly status: 'pending' | 'accepted' | 'revoked';
  readonly invitedBy: string | null;
  readonly createdAt: string;
  readonly acceptedAt: string | null;
}

export type OnboardingState =
  | 'connected'
  | 'scope-selected'
  | 'statuses-mapped'
  | 'actors-mapped'
  | 'assumptions-set'
  | 'ready';

export const ONBOARDING_ORDER: readonly OnboardingState[] = [
  'connected',
  'scope-selected',
  'statuses-mapped',
  'actors-mapped',
  'assumptions-set',
  'ready',
];

export function onboardingRank(state: OnboardingState): number {
  return ONBOARDING_ORDER.indexOf(state);
}

export interface WorkspaceRecord {
  readonly id: string;
  readonly tenantId: string;
  /**
   * Monitoring Workspace display name ('Engineering', 'Customer Success'), set
   * by the customer. Null until named, in which case the UI falls back to the
   * scope name. A workspace is already a persistent operational view — the
   * integration, the selected scope, the salary assumptions, its members, and
   * its whole run history — and this is what gives that view an identity.
   */
  readonly name: string | null;
  /** Connector id ('jira', 'clickup', …) — resolved via the connector registry. */
  readonly provider: string;
  /**
   * Non-secret connection parameters whose shape belongs to the connector
   * (Jira: {site, email}; ClickUp: {}). The secret itself is only ever in
   * tokenCiphertext. Stored as `connection_params` (legacy Jira rows are
   * backfilled from the old site/email columns by the idempotent migration).
   */
  readonly connectionParams: Readonly<Record<string, string>>;
  readonly tokenCiphertext: string;
  /** Selected import scope (a Jira project key, a ClickUp List id). Stored in the legacy project_key/project_name columns. */
  readonly scopeId: string | null;
  readonly scopeName: string | null;
  readonly observedStatuses: readonly string[];
  readonly observedActors: readonly string[];
  /**
   * Connector-suggested status→stage defaults captured at scope time (e.g.
   * ClickUp status types). FORM DEFAULTS only — the user reviews and submits
   * every mapping (invariant 6); nothing prices off a hint.
   */
  readonly statusHints: Readonly<Record<string, StageKind>> | null;
  readonly statusMap: Readonly<Record<string, StageKind>> | null;
  readonly actorRoleMap: Readonly<Record<string, string>> | null;
  readonly assumptions: AssumptionSet | null;
  readonly onboarding: OnboardingState;
  readonly createdAt: string;
}

export type WorkspacePatch = Partial<
  Pick<
    WorkspaceRecord,
    | 'name'
    | 'provider'
    | 'connectionParams'
    | 'scopeId'
    | 'scopeName'
    | 'observedStatuses'
    | 'observedActors'
    | 'statusHints'
    | 'statusMap'
    | 'actorRoleMap'
    | 'assumptions'
    | 'onboarding'
    | 'tokenCiphertext'
  >
>;

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type JobErrorClass = 'auth-error' | 'fetch-error' | 'import-error' | 'unexpected';

export interface JobRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly status: JobStatus;
  readonly errorClass: JobErrorClass | null;
  /** Sanitized at write time — never contains tokens or salts. */
  readonly errorMessage: string | null;
  readonly runId: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

export interface RunRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly runJson: string;
  readonly reportMd: string;
  readonly telemetryJsonl: string;
}

/**
 * A run's metadata WITHOUT its artifacts.
 *
 * A Monitoring Workspace is a persistent operational view, so its natural query
 * is "the last N analyses of this workspace, in order" — which is what powers
 * the existing run-over-run trend section and what run comparison and trend
 * charts will need. Answering it by loading RunRecords is quadratic in blob
 * size: run.json, report.md, and the telemetry stream for every run, to end up
 * reading one of them. This is the cheap ordered index over the same rows.
 *
 * No richer projection is needed here, and deliberately so: `run.json` is a
 * self-contained artifact (NFR-2) that embeds its own batch, assumption set,
 * and every pinned engine version. So any two runs are directly comparable from
 * what is already stored, including runs produced before and after a salary or
 * scope change — the configuration a number was computed under travels with the
 * number. Comparison and trend analysis are therefore read-side features over
 * data already in the table, not a schema question.
 */
export interface RunHeader {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly viewedAt: string | null;
}

/**
 * Cascade counts returned by a deletion (FR-22 / NFR-6). Counts only — never
 * identities — so a caller (and telemetry) can report the blast radius of an
 * erasure without touching customer data.
 */
export interface DeletionSummary {
  readonly workspaces: number;
  readonly jobs: number;
  readonly runs: number;
}

/**
 * Activation-funnel counts (v1 founder analytics). Aggregate counts of DISTINCT
 * organizations reaching each stage — no identities, emails, or customer
 * content. Derived from existing tables (no separate event log).
 */
export interface FunnelStats {
  readonly organizations: number;
  readonly connectedWorkspaces: number;
  readonly analysesRun: number;
  readonly reportsViewed: number;
}

/**
 * Admin operations console (COSTFLOW_ADMIN_EMAILS only). Everything below is
 * CROSS-TENANT by design — a deliberate, audited exception to the tenancy law,
 * unreachable without the admin allowlist. Every projection is trimmed to
 * exclude secrets (token/salt ciphertext) and raw financial run content
 * (run_json / report_md / telemetry); operational metadata only.
 */
export interface AdminListParams {
  readonly limit: number;
  readonly offset: number;
  /** Whitelisted sort column (per table); ignored if not recognized. */
  readonly sort?: string;
  readonly dir?: 'asc' | 'desc';
  /** Free-text search over that table's whitelisted text columns. */
  readonly q?: string;
  /** Restrict to one organization (drill-down). */
  readonly tenantId?: string;
  /** Per-table status filter (jobs, invitations). */
  readonly status?: string;
}

export interface AdminPage<T> {
  readonly rows: readonly T[];
  readonly total: number;
  /**
   * Set when the result was computed over a bounded scan rather than the whole
   * table, so the console can say so instead of implying full coverage.
   */
  readonly truncated?: boolean;
}

export interface AdminCounts {
  readonly tenants: number;
  readonly users: number;
  readonly workspaces: number;
  readonly jobs: number;
  readonly runs: number;
  readonly invitations: number;
  readonly pendingInvitations: number;
  readonly failedJobs: number;
  readonly runningJobs: number;
}

export interface AdminTenantRow {
  readonly id: string;
  readonly name: string | null;
  readonly createdAt: string;
  readonly users: number;
  readonly workspaces: number;
  readonly runs: number;
  readonly lastActivityAt: string | null;
}

export interface AdminUserRow {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: OrgRole;
  readonly createdAt: string;
}

export interface AdminWorkspaceRow {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly connectionParams: Readonly<Record<string, string>>;
  readonly scopeId: string | null;
  readonly scopeName: string | null;
  readonly onboarding: OnboardingState;
  /** Presence of a stored token — NEVER the token itself. */
  readonly hasToken: boolean;
  readonly createdAt: string;
}

export interface AdminJobRow {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly status: JobStatus;
  readonly errorClass: JobErrorClass | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

export interface AdminRunRow {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly viewed: boolean;
}

export interface AdminInvitationRow {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: OrgRole;
  readonly status: InvitationRecord['status'];
  readonly invitedBy: string | null;
  readonly createdAt: string;
  readonly acceptedAt: string | null;
}

export interface AdminSearchHit {
  readonly kind: 'tenant' | 'user' | 'workspace' | 'job' | 'run';
  readonly id: string;
  readonly tenantId: string;
  readonly label: string;
  readonly sub: string;
}

export interface AdminAuditRow {
  readonly id: string;
  readonly at: string;
  readonly adminEmail: string;
  readonly action: string;
  readonly targetKind: string | null;
  readonly targetId: string | null;
  readonly targetTenantId: string | null;
  readonly detail: Readonly<Record<string, unknown>> | null;
}

/** A console action to record. `at`/`id` are assigned by the store. */
export interface AdminAuditEntry {
  readonly adminUserId: string | null;
  readonly adminEmail: string;
  readonly action: string;
  readonly targetKind: string | null;
  readonly targetId: string | null;
  readonly targetTenantId: string | null;
  readonly detail: Readonly<Record<string, unknown>> | null;
}

// ---------------------------------------------------------------------------
// Billing (P4.5). Shaped for Lemon Squeezy from day one so that integrating it
// later is a write path rather than a migration — but NOTHING here is invented.
// CostFlow is free during beta, so every organization is plan 'beta',
// billing_status 'free_beta', provider 'none', and every date column is null.
// ---------------------------------------------------------------------------

/** 'free_beta' is CostFlow's own state; the rest are Lemon Squeezy's statuses. */
export type BillingStatus =
  'free_beta' | 'on_trial' | 'active' | 'paused' | 'past_due' | 'unpaid' | 'cancelled' | 'expired';

export type BillingProvider = 'none' | 'lemonsqueezy';

export interface SubscriptionRecord {
  readonly tenantId: string;
  /** 'beta' today. Maps to the Lemon Squeezy variant name once billing is live. */
  readonly plan: string;
  readonly billingStatus: BillingStatus;
  readonly provider: BillingProvider;
  /** Lemon Squeezy customer id. Null until billing is integrated. */
  readonly providerCustomerId: string | null;
  /** Lemon Squeezy subscription id. */
  readonly providerSubscriptionId: string | null;
  /** Lemon Squeezy variant id — the variant IS the plan in the LS model. */
  readonly providerVariantId: string | null;
  readonly trialEndsAt: string | null;
  readonly renewsAt: string | null;
  readonly currentPeriodEnd: string | null;
  readonly cancelledAt: string | null;
  readonly endsAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Activity spine (P4.5). Durable, append-only, tenant-scoped, actor-attributed.
// ---------------------------------------------------------------------------

/**
 * The durable event vocabulary as it stands today. Deliberately the same
 * lifecycle points the interaction telemetry already emitted (telemetry-web.ts),
 * so this adds durability rather than a second, divergent vocabulary.
 *
 * This list is the KNOWN set, not the permitted set — see `EventType`.
 */
export type KnownEventType =
  | 'org.created'
  | 'org.renamed'
  | 'user.created'
  | 'session.started'
  | 'workspace.connected'
  | 'workspace.named'
  | 'workspace.ready'
  | 'scope.selected'
  | 'statuses.mapped'
  | 'actors.mapped'
  | 'assumptions.set'
  | 'analysis.started'
  | 'analysis.completed'
  | 'import.finished'
  | 'report.viewed'
  | 'member.invited'
  | 'member.joined'
  | 'member.role-changed'
  | 'member.removed'
  | 'invitation.revoked'
  | 'workspace.member-added'
  | 'workspace.member-removed'
  | 'data.deleted';

/**
 * What the events table accepts: any type string at all.
 *
 * The spine is the canonical source for product analytics, funnels, timelines,
 * and whatever operational intelligence comes next, so introducing a new event
 * type must cost nothing. It costs nothing here by construction: the column is
 * plain `text` with no CHECK and no enum, `fields` is open jsonb, and this type
 * is an OPEN union. Adding an event type is one call site and (optionally) one
 * line in `KnownEventType` — never a migration, never a new column, never a
 * table per event.
 *
 * Open rather than closed for a second, harder reason: during a rolling deploy
 * two replicas run different code, so the older one WILL read rows whose type it
 * has never heard of. A closed union would make that a lie the compiler believes.
 * Every consumer therefore treats an unrecognized type as data (the activity
 * feed renders it verbatim, filters match it, counts include it) rather than
 * as an error. `KnownEventType` still gives authoring-time autocomplete and
 * catches typos at the call sites that matter.
 */
export type EventType = KnownEventType | (string & Record<never, never>);

/** The known vocabulary, in lifecycle order. Powers the activity-feed filter. */
export const EVENT_TYPES: readonly KnownEventType[] = [
  'org.created',
  'org.renamed',
  'user.created',
  'session.started',
  'workspace.connected',
  'workspace.named',
  'workspace.ready',
  'scope.selected',
  'statuses.mapped',
  'actors.mapped',
  'assumptions.set',
  'analysis.started',
  'analysis.completed',
  'import.finished',
  'report.viewed',
  'member.invited',
  'member.joined',
  'member.role-changed',
  'member.removed',
  'invitation.revoked',
  'workspace.member-added',
  'workspace.member-removed',
  'data.deleted',
];

/**
 * An event to append. `fields` carries counts, enums, and booleans ONLY — never
 * emails, titles, tokens, or customer vocabulary (the same privacy rule the
 * interaction telemetry follows). `at` is assigned by the store.
 */
export interface EventInput {
  readonly tenantId: string;
  readonly userId: string | null;
  readonly workspaceId: string | null;
  readonly type: EventType;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface EventRecord extends EventInput {
  readonly id: string;
  readonly at: string;
}

/** An activity-feed row: an event joined to the display names an admin needs. */
export interface AdminActivityRow {
  readonly id: string;
  readonly at: string;
  readonly type: EventType;
  readonly tenantId: string;
  readonly orgName: string | null;
  readonly userId: string | null;
  readonly userEmail: string | null;
  readonly workspaceId: string | null;
  readonly workspaceName: string | null;
  readonly fields: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Customer database (P4.5). A "customer" row is a PERSON (identity + sign-in
// activity, which is per-user) carrying their organization's product usage
// (analyses, reports, connections — org-level, because runs/jobs/workspaces
// carry no actor for anything that happened before the activity spine existed).
// The console labels which is which; it never presents org usage as personal.
// ---------------------------------------------------------------------------

export type CustomerStatus = 'new' | 'onboarding' | 'active' | 'inactive' | 'churn-risk';
export type HealthBand = 'healthy' | 'needs-attention' | 'inactive' | 'churn-risk';

/**
 * Everything the deterministic health score reads. Measured by the store, never
 * by the scorer: given the same signals the score is always the same number,
 * which is what makes it explainable and testable.
 */
export interface CustomerSignals {
  readonly nowIso: string;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
  readonly signInCount: number;
  readonly workspaces: number;
  readonly readyWorkspaces: number;
  readonly analyses: number;
  readonly analyses30d: number;
  readonly lastAnalysisAt: string | null;
  readonly reportsViewed: number;
  /** Highest onboarding rank reached across the org's workspaces; -1 if none. */
  readonly onboardingRank: number;
  /** A session was observed more than 24h after the first one (a real return). */
  readonly returned: boolean;
}

export interface AdminCustomerRow {
  // Identity (per user).
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly orgName: string | null;
  readonly role: OrgRole;
  readonly createdAt: string;
  readonly identity: UserIdentity;
  // Product usage (organization-level).
  readonly workspaces: number;
  readonly readyWorkspaces: number;
  /** Distinct connected providers in the org, e.g. ['clickup', 'jira']. */
  readonly providers: readonly string[];
  readonly analyses: number;
  readonly analyses30d: number;
  readonly lastAnalysisAt: string | null;
  readonly reportsViewed: number;
  readonly lastActivityAt: string | null;
  // Billing (organization-level).
  readonly plan: string;
  readonly billingStatus: BillingStatus;
  // Derived, deterministic.
  readonly status: CustomerStatus;
  readonly health: HealthBand;
  readonly healthScore: number;
  readonly signals: CustomerSignals;
}

/** Customer-table filters, layered on the shared list params. */
export interface AdminCustomerParams extends AdminListParams {
  /** CustomerStatus, or '' for all. Overrides the inherited `status`. */
  readonly customerStatus?: string;
  readonly health?: string;
  /** Restrict to orgs with a connection to this provider. */
  readonly provider?: string;
  readonly plan?: string;
  /** ISO dates bounding user creation. */
  readonly signedUpFrom?: string;
  readonly signedUpTo?: string;
  /** Only customers seen since this ISO instant. */
  readonly activeSince?: string;
}

/** One organization's rollup for the organization view. */
export interface AdminOrgDetail {
  readonly tenantId: string;
  readonly name: string | null;
  readonly createdAt: string;
  readonly members: number;
  readonly workspaces: number;
  readonly readyWorkspaces: number;
  readonly providers: readonly string[];
  readonly analyses: number;
  readonly analyses30d: number;
  readonly reportsViewed: number;
  readonly lastActivityAt: string | null;
  readonly lastAnalysisAt: string | null;
  readonly subscription: SubscriptionRecord | null;
  readonly signals: CustomerSignals;
  /** Analyses per ISO date over the trailing window, oldest first. */
  readonly trend: readonly { readonly date: string; readonly analyses: number }[];
}

/** A Monitoring Workspace as the console reports it. */
export interface AdminMonitoringWorkspaceRow {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string | null;
  readonly provider: string;
  readonly scopeName: string | null;
  readonly onboarding: OnboardingState;
  readonly members: number;
  readonly analyses: number;
  readonly lastAnalysisAt: string | null;
  readonly lastSyncAt: string | null;
  readonly createdAt: string;
}

/**
 * One onboarding-funnel step. `reached` counts ORGANIZATIONS (a single, stable
 * denominator — mixing user-level and org-level steps in one funnel is how a
 * funnel ends up reporting conversion above 100%).
 *
 * `avgToNextMs` is null when the timing cannot be known rather than estimated:
 * the middle onboarding milestones have no stored history before the activity
 * spine existed, so for older organizations the step membership is read from
 * current workspace state and the timing is simply unavailable.
 */
export interface FunnelStep {
  readonly key: string;
  readonly label: string;
  readonly reached: number;
  readonly avgToNextMs: number | null;
  /** True when membership came from current state rather than a timestamped event. */
  readonly fromState: boolean;
}

export interface FunnelReport {
  readonly steps: readonly FunnelStep[];
  readonly from: string | null;
  readonly to: string | null;
}

/** Executive dashboard metrics. Counts only; no identities. */
export interface AdminDashboard {
  readonly users: number;
  readonly organizations: number;
  readonly newUsersToday: number;
  readonly newUsersWeek: number;
  readonly newOrgsWeek: number;
  readonly activeUsers30d: number;
  readonly activeUsers7d: number;
  readonly returningUsers: number;
  readonly churnRiskOrgs: number;
  readonly connectedByProvider: readonly { readonly provider: string; readonly orgs: number }[];
  readonly analysesToday: number;
  readonly reportsViewedToday: number;
  readonly monitoringWorkspaces: number;
  readonly activeTrials: number;
  readonly signupsByDay: readonly { readonly date: string; readonly users: number }[];
  readonly analysesByDay: readonly { readonly date: string; readonly analyses: number }[];
}

export interface Store {
  createTenantWithUser(
    email: string,
    saltCiphertext: string,
  ): Promise<{ tenant: TenantRecord; user: UserRecord }>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  getTenant(tenantId: string): Promise<TenantRecord | null>;
  /** Organization display name (P4.4 org settings); returns null if renamed away. */
  updateTenantName(tenantId: string, name: string): Promise<TenantRecord | null>;

  // Membership & roles (P4.4). All tenant-scoped by the tenancy law.
  getUser(tenantId: string, userId: string): Promise<UserRecord | null>;
  listUsers(tenantId: string): Promise<UserRecord[]>;
  /** Provision a NEW email into an EXISTING org (invitation accept). */
  createUserInTenant(tenantId: string, email: string, role: OrgRole): Promise<UserRecord>;
  updateUserRole(tenantId: string, userId: string, role: OrgRole): Promise<UserRecord | null>;
  /** Remove a member from the org; also drops their workspace memberships. */
  removeUser(tenantId: string, userId: string): Promise<boolean>;

  // Invitations (P4.4).
  createInvitation(
    tenantId: string,
    data: { email: string; role: OrgRole; token: string; invitedBy: string | null },
  ): Promise<InvitationRecord>;
  /** By opaque token — NOT tenant-scoped; the token is the capability. */
  getInvitationByToken(token: string): Promise<InvitationRecord | null>;
  listInvitations(tenantId: string): Promise<InvitationRecord[]>;
  updateInvitationStatus(
    tenantId: string,
    invitationId: string,
    status: InvitationRecord['status'],
    acceptedAt: string | null,
  ): Promise<InvitationRecord | null>;

  // Workspace membership (P4.4 multi-workspace foundation). Members see only
  // the workspaces they belong to; owners/admins see all in the org.
  addWorkspaceMember(tenantId: string, workspaceId: string, userId: string): Promise<void>;
  removeWorkspaceMember(tenantId: string, workspaceId: string, userId: string): Promise<void>;
  listWorkspaceMemberIds(tenantId: string, workspaceId: string): Promise<string[]>;
  listWorkspaceIdsForMember(tenantId: string, userId: string): Promise<string[]>;

  createWorkspace(
    tenantId: string,
    data: Pick<WorkspaceRecord, 'provider' | 'connectionParams' | 'tokenCiphertext'>,
  ): Promise<WorkspaceRecord>;
  getWorkspace(tenantId: string, workspaceId: string): Promise<WorkspaceRecord | null>;
  listWorkspaces(tenantId: string): Promise<WorkspaceRecord[]>;
  updateWorkspace(
    tenantId: string,
    workspaceId: string,
    patch: WorkspacePatch,
  ): Promise<WorkspaceRecord | null>;

  createJob(tenantId: string, workspaceId: string): Promise<JobRecord>;
  getJob(tenantId: string, jobId: string): Promise<JobRecord | null>;
  listJobsForWorkspace(tenantId: string, workspaceId: string): Promise<JobRecord[]>;
  updateJob(
    tenantId: string,
    jobId: string,
    patch: Partial<
      Pick<JobRecord, 'status' | 'errorClass' | 'errorMessage' | 'runId' | 'finishedAt'>
    >,
  ): Promise<JobRecord | null>;

  createRun(run: RunRecord): Promise<void>;
  getRun(tenantId: string, runId: string): Promise<RunRecord | null>;
  listRuns(tenantId: string): Promise<RunRecord[]>;
  /**
   * Run metadata for one Monitoring Workspace, newest first, artifacts excluded.
   * The ordered history of a workspace: what a trend series is computed over,
   * and how the report view finds the run to compare against.
   */
  listWorkspaceRunHeaders(tenantId: string, workspaceId: string): Promise<RunHeader[]>;
  /** Records a report view; resolves true iff this was the first view (funnel telemetry). */
  markRunViewed(tenantId: string, runId: string, nowIso: string): Promise<boolean>;

  /**
   * FR-22: permanently delete one workspace and everything derived from it
   * (its jobs and runs), in a single atomic step, tenant-scoped. Resolves the
   * cascade counts, or null if the workspace does not belong to the tenant —
   * a foreign id deletes nothing (tenancy law). Runs are append-only during
   * normal operation; explicit erasure is the ONLY path that removes them.
   */
  deleteWorkspace(tenantId: string, workspaceId: string): Promise<DeletionSummary | null>;

  /**
   * FR-22 / NFR-6 (GDPR erasure): permanently delete ALL of a tenant's data —
   * runs, jobs, workspaces, users, and the tenant row itself — atomically.
   * Resolves the cascade counts (idempotent: an already-absent tenant yields
   * zeros). Only ever the caller's own tenant, scoped by the session.
   */
  deleteTenantData(tenantId: string): Promise<DeletionSummary>;

  /** Startup recovery (plan §3): jobs left 'running' by a crash → failed/interrupted. */
  markInterruptedJobs(nowIso: string): Promise<number>;

  /** Aggregate activation-funnel counts (v1). Distinct orgs per stage; no identities. */
  funnelStats(): Promise<FunnelStats>;

  // --- Admin operations console (COSTFLOW_ADMIN_EMAILS only; cross-tenant). ---
  adminCounts(): Promise<AdminCounts>;
  adminListTenants(params: AdminListParams): Promise<AdminPage<AdminTenantRow>>;
  adminListUsers(params: AdminListParams): Promise<AdminPage<AdminUserRow>>;
  adminListWorkspaces(params: AdminListParams): Promise<AdminPage<AdminWorkspaceRow>>;
  adminListJobs(params: AdminListParams): Promise<AdminPage<AdminJobRow>>;
  adminListRuns(params: AdminListParams): Promise<AdminPage<AdminRunRow>>;
  adminListInvitations(params: AdminListParams): Promise<AdminPage<AdminInvitationRow>>;
  /** Cross-tenant search over org names, user emails, workspace scopes, and ids. */
  adminSearch(q: string, limit: number): Promise<AdminSearchHit[]>;
  adminLogAction(entry: AdminAuditEntry): Promise<void>;
  adminListAudit(params: AdminListParams): Promise<AdminPage<AdminAuditRow>>;

  // --- Customer database & activity spine (P4.5; admin allowlist only). ---

  /**
   * Append one activity event. Append-only: there is no update or delete path
   * other than tenant erasure. Callers treat this as best-effort — a failure to
   * record activity must never fail the customer's request.
   */
  recordEvent(event: EventInput): Promise<void>;

  /** Identity attributes observed at sign-in; bumps sign-in count and last-seen. */
  recordSignIn(userId: string, observation: IdentityObservation, nowIso: string): Promise<void>;
  /**
   * Refresh last-seen for an authenticated request. Throttled by the caller so
   * this is at most one write per user per interval, never one per request.
   */
  touchLastSeen(userId: string, nowIso: string): Promise<void>;

  /** Billing state for one organization; null if the row does not exist yet. */
  getSubscription(tenantId: string): Promise<SubscriptionRecord | null>;
  /** Create the free-beta row for a new organization. */
  ensureSubscription(tenantId: string, nowIso: string): Promise<SubscriptionRecord>;

  /** The customer database: identity + org usage + deterministic health, paginated. */
  adminListCustomers(params: AdminCustomerParams): Promise<AdminPage<AdminCustomerRow>>;
  /** One customer, or null if absent. */
  adminGetCustomer(userId: string): Promise<AdminCustomerRow | null>;
  /** Newest-first activity for one user, across the whole spine. */
  adminUserTimeline(userId: string, limit: number): Promise<AdminActivityRow[]>;
  /** Organization rollup for the organization view. */
  adminOrgDetail(
    tenantId: string,
    nowIso: string,
    trendDays: number,
  ): Promise<AdminOrgDetail | null>;
  /** Monitoring Workspaces for one organization, or all when tenantId is absent. */
  adminListMonitoringWorkspaces(
    params: AdminListParams,
  ): Promise<AdminPage<AdminMonitoringWorkspaceRow>>;
  /** Cross-tenant activity feed, newest first. */
  adminActivityFeed(params: AdminListParams): Promise<AdminPage<AdminActivityRow>>;
  /** Ten-step onboarding funnel over an optional date range. */
  adminFunnel(from: string | null, to: string | null, nowIso: string): Promise<FunnelReport>;
  /** Executive dashboard metrics. */
  adminDashboard(nowIso: string, days: number): Promise<AdminDashboard>;

  /** Readiness probe (P4.2 §4): resolves iff the backing store is reachable. */
  ping(): Promise<void>;
}
