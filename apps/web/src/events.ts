import type { EventInput, EventType, Store } from './store/contract';
import type { TelemetrySink, WebTelemetryEventName } from './telemetry-web';
import { webEvent } from './telemetry-web';

/**
 * Durable activity spine (P4.5).
 *
 * CostFlow already emitted interaction telemetry at every meaningful lifecycle
 * point, but only to a local JSONL file: per-replica, and erased by every
 * deploy. So the data existed and then evaporated. This module keeps that same
 * vocabulary and adds the durable half — one append-only `events` row per
 * interaction, carrying WHO did it (the missing piece: workspaces, jobs, and
 * runs record a tenant but no actor).
 *
 * Two rules govern everything here:
 *
 *  1. Recording activity must never break the product. Every write is
 *     fire-and-forget and failure-contained; a database hiccup while logging a
 *     report view cannot fail the report.
 *  2. Fields are counts, enums, booleans, and ids ONLY. `sanitizeFields` below
 *     enforces that mechanically rather than trusting call sites to remember —
 *     no emails, issue titles, tokens, salts, or customer vocabulary can reach
 *     the table even if a future caller passes them.
 */

/**
 * Existing interaction-telemetry name → durable event type. Deliberately a
 * mapping rather than a second vocabulary, so the two never drift.
 */
export const TELEMETRY_TO_EVENT: Readonly<Partial<Record<WebTelemetryEventName, EventType>>> = {
  'tm-web-signin': 'session.started',
  'tm-web-workspace-connected': 'workspace.connected',
  'tm-web-workspace-named': 'workspace.named',
  'tm-web-scope-selected': 'scope.selected',
  'tm-web-statuses-mapped': 'statuses.mapped',
  'tm-web-actors-mapped': 'actors.mapped',
  'tm-web-assumptions-confirmed': 'assumptions.set',
  // Emitted once the job settles, carrying its outcome — so it is the
  // COMPLETION of an analysis, not its start. POST /runs records the start
  // separately, which is what gives the console a real duration.
  'tm-web-run': 'analysis.completed',
  'tm-web-report-viewed': 'report.viewed',
  'tm-web-data-deleted': 'data.deleted',
  'tm-web-org-renamed': 'org.renamed',
  'tm-web-member-invited': 'member.invited',
  'tm-web-invite-accepted': 'member.joined',
  'tm-web-invite-revoked': 'invitation.revoked',
  'tm-web-member-role-changed': 'member.role-changed',
  'tm-web-member-removed': 'member.removed',
  'tm-web-workspace-member-added': 'workspace.member-added',
  'tm-web-workspace-member-removed': 'workspace.member-removed',
};

/** Who and what an event is about. */
export interface EventContext {
  readonly tenantId: string;
  readonly userId?: string | null;
  readonly workspaceId?: string | null;
}

/**
 * Maximum length of a string field. Long strings are the shape customer
 * vocabulary arrives in, so they are truncated rather than stored whole.
 */
const MAX_FIELD_CHARS = 64;
const MAX_FIELDS = 12;

/**
 * Reduce arbitrary call-site fields to the privacy-safe subset the events table
 * accepts: booleans, finite numbers, null, and short strings (enums, provider
 * ids, error classes). Objects, arrays, and functions are dropped entirely —
 * nested structures are how free-text sneaks into a log.
 *
 * This is a guard, not a formatter: correct call sites pass only safe values
 * anyway. It exists so that a future call site cannot leak by accident.
 */
export function sanitizeFields(
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (n >= MAX_FIELDS) break;
    if (value === null || typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
      else continue;
    } else if (typeof value === 'string') {
      out[key] = value.length > MAX_FIELD_CHARS ? value.slice(0, MAX_FIELD_CHARS) : value;
    } else {
      continue;
    }
    n += 1;
  }
  return out;
}

/** Records one durable event. Never throws, never rejects. */
export type EventRecorder = (
  type: EventType,
  context: EventContext,
  fields?: Readonly<Record<string, unknown>>,
) => void;

/**
 * Fire-and-forget recorder backed by the Store.
 *
 * Deliberately synchronous in signature: callers must not be able to await it
 * (and so cannot accidentally make a customer request wait on analytics), and
 * the rejection is swallowed here so an unhandled rejection can never take the
 * process down. `onError` logs the error CLASS only — the P4.2 error-log leak
 * fix applies here too, since an error message can embed a query.
 */
export function storeEventRecorder(store: Store, onError?: (name: string) => void): EventRecorder {
  return (type, context, fields = {}) => {
    const event: EventInput = {
      tenantId: context.tenantId,
      userId: context.userId ?? null,
      workspaceId: context.workspaceId ?? null,
      type,
      fields: sanitizeFields(fields),
    };
    void store.recordEvent(event).catch((error: unknown) => {
      onError?.(error instanceof Error ? error.name : 'UnknownError');
    });
  };
}

/** A recorder that does nothing. Used where no store is wired (pure render tests). */
export const nullEventRecorder: EventRecorder = () => {};

/**
 * Emit one interaction to BOTH sinks: the existing local telemetry file (kept
 * for CLI/dev parity) and the durable events table. Call sites keep their
 * original telemetry vocabulary and simply gain the context needed to attribute
 * the event to an organization and a user.
 */
export function tracker(
  telemetry: TelemetrySink,
  record: EventRecorder,
): (
  name: WebTelemetryEventName,
  context: EventContext | null,
  fields?: Readonly<Record<string, unknown>>,
) => void {
  return (name, context, fields = {}) => {
    telemetry(webEvent(name, fields));
    const type = TELEMETRY_TO_EVENT[name];
    // No context means no tenant to attribute to (e.g. a failed sign-in before
    // any account is resolved). The local telemetry line above still records it.
    if (type && context) record(type, context, fields);
  };
}

/**
 * How long a `last_seen_at` value may go stale before an authenticated request
 * refreshes it. Bounds the write amplification of tracking activity on a
 * stateless-cookie app: at most one UPDATE per user per interval, rather than
 * one per request, while keeping "last active" accurate to within the interval.
 */
export const LAST_SEEN_THROTTLE_MS = 15 * 60 * 1000;

/** True when a stored last-seen is stale enough to be worth rewriting. */
export function shouldTouchLastSeen(lastSeenAt: string | null, nowIso: string): boolean {
  if (!lastSeenAt) return true;
  const last = Date.parse(lastSeenAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return true;
  return now - last >= LAST_SEEN_THROTTLE_MS;
}

/**
 * Connection prefix of an OIDC `sub` claim: 'google-oauth2|1234' → 'google-oauth2'.
 * Only the connection is retained; the subject identifier itself is not stored.
 */
export function authProviderFromSub(sub: string | undefined): string | undefined {
  if (typeof sub !== 'string' || sub === '') return undefined;
  const idx = sub.indexOf('|');
  const prefix = idx > 0 ? sub.slice(0, idx) : sub;
  return prefix.length > 0 && prefix.length <= 40 ? prefix : undefined;
}
