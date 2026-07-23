import type {
  ImportBatch,
  IsoDateString,
  PseudonymizationContext,
  StageKind,
} from '@costflow/domain';

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

/** One selectable import scope (a Jira project, a ClickUp List, …). */
export interface ScopeRef {
  readonly id: string;
  readonly name: string;
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
