import type { ImportBatch, PseudonymizationContext, StageKind } from '@costflow/domain';
import type { ProviderDescriptor } from '@costflow/ingestion';
import type { WorkspaceRecord } from '../store/contract';

/**
 * Web connector SPI (doc 18 §4.1) — the uniform EFFECTFUL half of a provider
 * at the web edge, mirroring the pure SPI's fetch/transform split (doc 15 P1):
 * a connector fetches raw response documents verbatim and DELEGATES all
 * derivation to its pure transform in @costflow/ingestion. The server, job
 * runner, and onboarding routes dispatch on `workspace.provider` through the
 * registry and never name a provider.
 *
 * Laws:
 *  - Raw documents verbatim; no number, date, or identity derived here.
 *  - Failures are sanitized GatewayErrors (class + provider-local stage +
 *    optional HTTP status) — never URLs, credentials, or customer data.
 *  - Read-only by construction: no request mutates the source system.
 *  - The registry is static data — no plugins, no reflection (R-11).
 */

/** Sanitized connector failure. `stage` is a provider-local fetch stage label. */
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

/** A selectable import scope (Jira: a project; ClickUp: a Space). */
export interface ScopeRef {
  readonly key: string;
  readonly name: string;
}

/** One field of a connector's credential form (rendered by /connect/:provider). */
export interface CredentialField {
  readonly name: string;
  readonly label: string;
  readonly type: 'text' | 'email' | 'password';
  readonly placeholder: string;
  /** Extra input attributes (autocomplete, inputmode); never values. */
  readonly attributes?: string;
}

/**
 * A parsed, validated connection. `display` holds the NON-secret fields
 * persisted as workspace.connection (and shown in summaries); `secret` is the
 * one credential value, encrypted with AES-256-GCM before it is stored.
 */
export interface ParsedConnection {
  readonly display: Readonly<Record<string, string>>;
  readonly secret: string;
}

/** A live connection at use time: display fields + the decrypted secret. */
export interface Connection {
  readonly display: Readonly<Record<string, string>>;
  readonly secret: string;
}

export interface TransformArgs {
  readonly batchId: string;
  readonly statusMap: Readonly<Record<string, StageKind>>;
  readonly actorRoleMap?: Readonly<Record<string, string>> | undefined;
  readonly mappingId: string;
  readonly mappingVersion: string;
  readonly importedAt: string;
  readonly pseudonymization?: PseudonymizationContext | undefined;
}

export interface WebConnector {
  readonly descriptor: ProviderDescriptor;
  /** UI vocabulary for the scope step ("project", "Space"). */
  readonly scopeNoun: { readonly singular: string; readonly plural: string };
  /** One-line product pitch shown on the provider picker card. */
  readonly pickerHint: string;
  readonly credentialFields: readonly CredentialField[];
  /** CSP-safe help block: how to obtain the credential (~60s walkthrough). */
  readonly connectionHelpHtml: string;

  /** Validate the posted form. Returns an error message OR the parsed connection. */
  parseCredentials(
    body: Readonly<Record<string, string | undefined>>,
  ): { ok: true; connection: ParsedConnection } | { ok: false; error: string };

  /** Rebuild a live connection from the stored workspace + decrypted secret. */
  connectionFrom(workspace: WorkspaceRecord, secret: string): Connection;

  /** Non-secret one-line summary for dashboards/settings ("Jira site X as Y"). */
  summaryText(workspace: WorkspaceRecord): string;

  /** List selectable scopes. Also the connection-validation probe. */
  listScopes(connection: Connection): Promise<ScopeRef[]>;

  /** Fetch every raw document for a scope, verbatim. Opaque to the caller. */
  fetchAll(connection: Connection, scopeKey: string): Promise<unknown>;

  /** Item count from the raw payload — the pre-analysis reliability guard. */
  countItems(payload: unknown): number;

  /** Observed mapping vocabulary (statuses, actor values) from the raw payload. */
  observe(payload: unknown): { statuses: string[]; actors: string[] };

  /** Delegate to the provider's PURE transform in @costflow/ingestion. */
  transform(payload: unknown, args: TransformArgs): ImportBatch;
}

export type ConnectorRegistry = Readonly<Record<string, WebConnector>>;

export function connectorFor(registry: ConnectorRegistry, provider: string): WebConnector {
  const connector = registry[provider];
  if (!connector) {
    // A workspace row naming an unregistered provider is a deployment defect
    // (e.g. rollback past the connector), not a user error.
    throw new GatewayError('fetch-error', 'registry', `Unknown provider "${provider}".`);
  }
  return connector;
}
