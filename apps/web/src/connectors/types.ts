import type {
  ImportBatch,
  IsoDateString,
  PseudonymizationContext,
  StageKind,
} from '@costflow/domain';
import type { ConnectorEvidence } from '../evidence';

/**
 * Web connector contract (ADR-0005). A connector is the product-layer face of
 * one work-tracking platform, pairing the pure ingestion transform (which
 * lives in @costflow/ingestion under providers/<id>/) with the app's
 * effectful HTTP gateway and the onboarding vocabulary. The rest of the web
 * app — routes, jobs, store — speaks ONLY these types; provider names, wire
 * shapes, and credential layouts stay inside apps/web/src/connectors/*.
 *
 * This mirrors the engine's SPI split (fetch is effectful and lives at the
 * edge; transform is pure and lives in ingestion): `gateway` is the effectful
 * half, `observe`/`buildBatch` are pure adapters over the ingestion
 * transform. Registry construction is static data + explicit wiring — no
 * plugins, no reflection (R-11 discipline).
 */

/**
 * Non-secret connection parameters (a Jira site URL + account email; nothing
 * for token-only providers). Rendered back into the reconnect form and shown
 * on the dashboard, so NEVER put a secret here — the secret travels apart and
 * is AES-encrypted at rest.
 */
export type ConnectionParams = Readonly<Record<string, string>>;

export interface ConnectorCredentials {
  readonly params: ConnectionParams;
  /** Decrypted only at the moment of use (plan §2); never logged or re-rendered. */
  readonly secret: string;
}

/**
 * One selectable import scope, at any level of the platform's own hierarchy: a
 * ClickUp Space, Folder or List, a Jira project, and whatever a future platform
 * calls its containers.
 *
 * A connector returns the hierarchy FLAT, with `parentId` carrying the shape.
 * Flat is deliberate: a tree would push rendering, filtering and selection
 * arithmetic into a recursive structure that every caller then has to walk,
 * when all any of them needs is "group these under their parent". Depth is a
 * property of the data here, not of the type, so a platform with four levels
 * needs no new type and no new code.
 */
export interface ScopeRef {
  readonly id: string;
  readonly name: string;
  /**
   * The platform's OWN word for this level ('Space', 'Folder', 'List',
   * 'project'), shown to the customer as-is. Provider vocabulary lives here and
   * never reaches the domain (doc 06 N4) — the engine has no concept of a
   * Folder, and giving it one would be the first provider name in the core.
   */
  readonly kind: string;
  /** Parent in the platform's hierarchy; null at the level the connector roots at. */
  readonly parentId: string | null;
  /**
   * True when this scope can be fetched on its own. A container is selectable
   * but NOT fetchable: choosing a Space means "everything inside it, as it
   * stands at run time", which is resolved fresh on every run rather than
   * frozen at selection time. That is why a Space gaining a List later shows up
   * as a coverage change in the run artifact and blocks a false trend, instead
   * of silently widening a total.
   */
  readonly fetchable: boolean;
}

/**
 * Expand a customer's selection into the fetchable scopes it covers RIGHT NOW.
 *
 * Provider-independent by construction: the only thing it needs is the
 * hierarchy each connector already describes, so a new platform gets container
 * selection for free by filling in `parentId` and `fetchable`. Selecting a
 * container includes every fetchable scope beneath it at any depth; selecting a
 * container and one of its children yields that child once.
 *
 * Deterministic: the result is sorted by id, so two runs over an unchanged
 * hierarchy resolve byte-identically regardless of the order the platform
 * happened to list things in.
 */
export function resolveSelection(
  all: readonly ScopeRef[],
  selectedIds: readonly string[],
): ScopeRef[] {
  const childrenOf = new Map<string, ScopeRef[]>();
  for (const scope of all) {
    if (scope.parentId === null) continue;
    const siblings = childrenOf.get(scope.parentId) ?? [];
    siblings.push(scope);
    childrenOf.set(scope.parentId, siblings);
  }
  const byId = new Map(all.map((s) => [s.id, s]));
  const resolved = new Map<string, ScopeRef>();
  const visited = new Set<string>();
  const walk = (scope: ScopeRef): void => {
    if (visited.has(scope.id)) return;
    visited.add(scope.id);
    if (scope.fetchable) resolved.set(scope.id, scope);
    for (const child of childrenOf.get(scope.id) ?? []) walk(child);
  };
  for (const id of selectedIds) {
    const scope = byId.get(id);
    // A selection the platform no longer reports is silently absent here. The
    // caller compares counts and refuses to run rather than analysing less than
    // the customer asked for — see `jobs.ts`.
    if (scope) walk(scope);
  }
  return [...resolved.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Raw provider documents fetched verbatim (SPI fetch half). The concrete
 * shape is private to the owning connector — everything else treats this as
 * an opaque, JSON-serializable value (jobs hash it for the run id). The
 * `provider` discriminant lets a connector refuse a foreign bundle loudly.
 */
export interface RawFetch {
  readonly provider: string;
}

/**
 * Sanitized gateway failure. Carries the connector's own STAGE label (e.g.
 * `list-scopes` | `search` | `changelog`) and, when the server answered, the
 * HTTP status — but never the URL, credentials, or any customer data.
 */
export class GatewayError extends Error {
  constructor(
    readonly errorClass: 'auth-error' | 'fetch-error',
    readonly stage: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/**
 * The effectful half of a connector: read-only HTTP against the provider.
 * Implementations must return raw response documents verbatim (the pure
 * transform is the only interpreter) and sanitize every failure to a
 * GatewayError.
 */
export interface ConnectorGateway {
  listScopes(credentials: ConnectorCredentials): Promise<ScopeRef[]>;
  fetchAll(credentials: ConnectorCredentials, scopeId: string): Promise<RawFetch>;
}

/** One /connect form field. `secret` fields are never echoed back on error. */
export interface ConnectFieldSpec {
  readonly name: string;
  readonly label: string;
  readonly kind: 'text' | 'email' | 'url' | 'secret';
  readonly placeholder: string;
  readonly autocomplete?: string;
}

/** Static onboarding vocabulary + form layout for one provider. */
export interface ConnectorDescriptor {
  readonly id: string;
  /** Display name ("Jira", "ClickUp"). */
  readonly name: string;
  /** What a connection is called in headings ("Jira workspace"). */
  readonly connectionNoun: string;
  /** What an import scope is called ("project", "List"). */
  readonly scopeNoun: { readonly singular: string; readonly plural: string };
  /** What imported items are called ("issues", "tasks"). */
  readonly itemNoun: string;
  /** One-sentence lead for the connect step. */
  readonly connectLead: string;
  readonly fields: readonly ConnectFieldSpec[];
  /** Trusted HTML for the "how to get a token" help box (static, not user data). */
  readonly helpHtml: string;
  /** Short marketing blurb for the provider picker card. */
  readonly pickerBlurb: string;
  /**
   * What evidence this platform can expose (ADR-0006). The diagnostics layer
   * never learns a provider name; this declaration is how a platform's limits
   * reach it, translated in `evidence.ts`. Adding a connector means adding this,
   * never a branch in packages/diagnostics.
   */
  readonly provides: ConnectorEvidence;
}

export interface ObservedWorkspace {
  /** Every status a run could encounter (current + historical), sorted. */
  readonly statuses: readonly string[];
  /** Every actor value the transform would consult, sorted. */
  readonly actors: readonly string[];
  /**
   * Per-status stage suggestions derived from PROVIDER metadata (e.g.
   * ClickUp's closed/done status types). Form defaults only — nothing is
   * stored until the user reviews and submits (invariant 6).
   */
  readonly statusHints: Readonly<Record<string, StageKind>>;
  /** Item count for the reliability ceiling check. */
  readonly itemCount: number;
}

export interface BuildBatchInput {
  readonly batchId: string;
  readonly raw: RawFetch;
  /**
   * Which origin `raw` came from. Always supplied by the app: a run always
   * knows what it fetched, and a batch that cannot say where its items came
   * from cannot be compared against the next one.
   */
  readonly scope: { readonly id: string; readonly label: string };
  readonly mappingId: string;
  readonly mappingVersion: string;
  readonly statusMap: Readonly<Record<string, StageKind>>;
  readonly actorRoleMap?: Readonly<Record<string, string>> | undefined;
  readonly importedAt: IsoDateString;
  readonly pseudonymization?: PseudonymizationContext | undefined;
}

export type ParsedConnectForm =
  | { readonly ok: true; readonly params: ConnectionParams; readonly secret: string }
  | { readonly ok: false; readonly error: string };

/**
 * One platform, fully described. `gateway` is the only effectful member;
 * everything else is pure and deterministic.
 */
export interface Connector {
  readonly descriptor: ConnectorDescriptor;
  readonly gateway: ConnectorGateway;
  /** Validate + normalize the /connect form; the error string is user-facing HTML-safe text. */
  parseConnectForm(body: Readonly<Record<string, unknown>>): ParsedConnectForm;
  /** One-line connection summary for dashboard/settings (params only — no secret). */
  describeConnection(params: ConnectionParams): string;
  /** Pure: vocabulary + count observed in a raw fetch (scope step). */
  observe(raw: RawFetch): ObservedWorkspace;
  /** Pure: raw documents → canonical ImportBatch via the ingestion transform. */
  buildBatch(input: BuildBatchInput): ImportBatch;
}
