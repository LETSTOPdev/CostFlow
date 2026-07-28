import {
  issuesNeedingChangelogTopUp,
  jiraChangelogUrl,
  jiraProjectsUrl,
  jiraSearchNextPageToken,
  jiraSearchUrl,
  observeJiraSearchPages,
  transformJira,
} from '@costflow/ingestion';
import { guessStageKind } from './suggest';
import {
  GatewayError,
  type BuildBatchInput,
  type ConnectionParams,
  type Connector,
  type ConnectorCredentials,
  type ConnectorDescriptor,
  type ConnectorGateway,
  type ObservedWorkspace,
  type RawFetch,
  type ScopeRef,
} from './types';
import type { ImportBatch, StageKind } from '@costflow/domain';

/**
 * Jira Cloud connector (doc 09 P4.1 plan §3/§7, generalized by ADR-0005):
 * the web app's effectful Jira half plus the pure adapters over the
 * ingestion transform. Read-only (GET) by construction; raw response
 * documents are returned verbatim for the pure transform. Errors are
 * sanitized to a class + stage + status — a token can never leak through an
 * error message (plan §2).
 */

/** Raw Jira fetch bundle — the wire shape is private to this module. */
export interface JiraRawFetch extends RawFetch {
  readonly provider: 'jira';
  readonly searchPages: readonly string[];
  readonly supplementaryChangelogs: Readonly<Record<string, readonly string[]>>;
}

const asJiraRaw = (raw: RawFetch): JiraRawFetch => {
  if (raw.provider !== 'jira') {
    throw new Error(`Jira connector received a "${raw.provider}" fetch bundle.`);
  }
  return raw as JiraRawFetch;
};

const connection = (credentials: ConnectorCredentials) => ({
  site: credentials.params['site'] ?? '',
  email: credentials.params['email'] ?? '',
  token: credentials.secret,
});

const PAGE_SIZE = 100;

export class HttpJiraGateway implements ConnectorGateway {
  constructor(private fetchFn: typeof fetch = fetch) {}

  private async getJson(
    credentials: ConnectorCredentials,
    url: string,
    stage: 'list-projects' | 'search' | 'changelog',
  ): Promise<string> {
    const { email, token } = connection(credentials);
    const authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      });
    } catch {
      // Never echo the underlying error — it can embed the request (plan §2).
      throw new GatewayError('fetch-error', stage, `Could not reach Jira (${stage}).`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new GatewayError(
        'auth-error',
        stage,
        `Jira rejected the credentials at ${stage} (HTTP ${response.status}).`,
        response.status,
      );
    }
    if (!response.ok) {
      throw new GatewayError(
        'fetch-error',
        stage,
        `Jira request failed at ${stage} (HTTP ${response.status}).`,
        response.status,
      );
    }
    return response.text();
  }

  async listScopes(credentials: ConnectorCredentials): Promise<ScopeRef[]> {
    const site = connection(credentials).site;
    const projects: ScopeRef[] = [];
    let startAt = 0;
    for (;;) {
      const text = await this.getJson(
        credentials,
        jiraProjectsUrl(site, startAt, PAGE_SIZE),
        'list-projects',
      );
      const doc = JSON.parse(text) as {
        values?: { key?: string; name?: string }[];
        isLast?: boolean;
        total?: number;
      };
      const values = doc.values ?? [];
      for (const value of values) {
        // Jira's hierarchy above a project (categories) is optional metadata
        // rather than a place work lives, so projects are the only level worth
        // selecting: every one of them is a flat, directly fetchable root.
        if (value.key) {
          projects.push({
            id: value.key,
            name: value.name ?? value.key,
            kind: 'project',
            parentId: null,
            fetchable: true,
          });
        }
      }
      startAt += values.length;
      if (doc.isLast === true || values.length === 0 || startAt >= (doc.total ?? startAt)) break;
    }
    return projects;
  }

  async fetchAll(credentials: ConnectorCredentials, scopeId: string): Promise<JiraRawFetch> {
    const site = connection(credentials).site;
    const searchPages: string[] = [];
    let pageToken: string | undefined;
    for (;;) {
      const text = await this.getJson(
        credentials,
        jiraSearchUrl(site, scopeId, pageToken, PAGE_SIZE),
        'search',
      );
      searchPages.push(text);
      const next = jiraSearchNextPageToken(text);
      if (next === null) break;
      pageToken = next;
    }

    const supplementaryChangelogs: Record<string, string[]> = {};
    const topUps = new Set<string>();
    for (const page of searchPages) {
      for (const key of issuesNeedingChangelogTopUp(page)) topUps.add(key);
    }
    for (const key of [...topUps].sort()) {
      let clStart = 0;
      for (;;) {
        const text = await this.getJson(
          credentials,
          jiraChangelogUrl(site, key, clStart, PAGE_SIZE),
          'changelog',
        );
        (supplementaryChangelogs[key] ??= []).push(text);
        const doc = JSON.parse(text) as { values?: unknown[]; total?: number; isLast?: boolean };
        clStart += doc.values?.length ?? 0;
        if (
          doc.isLast === true ||
          (doc.values?.length ?? 0) === 0 ||
          clStart >= (doc.total ?? clStart)
        )
          break;
      }
    }
    return { provider: 'jira', searchPages, supplementaryChangelogs };
  }
}

const JIRA_DESCRIPTOR: ConnectorDescriptor = {
  id: 'jira',
  name: 'Jira',
  connectionNoun: 'Jira workspace',
  scopeNoun: { singular: 'project', plural: 'projects' },
  itemNoun: 'issues',
  connectLead:
    "CostFlow reads your Jira with a personal API token. It's read-only, encrypted at rest, and never displayed after you save it. Setup takes about a minute.",
  fields: [
    {
      name: 'site',
      label: 'Jira site URL',
      kind: 'url',
      placeholder: 'https://your-org.atlassian.net',
      autocomplete: 'url',
    },
    {
      name: 'email',
      label: 'Account email',
      kind: 'email',
      placeholder: 'you@company.com',
      autocomplete: 'email',
    },
    {
      name: 'token',
      label: 'API token',
      kind: 'secret',
      placeholder: 'paste your Atlassian API token',
    },
  ],
  helpHtml: `<summary>How to get your Jira API token (~60 seconds)</summary>
           <ol class="note">
             <li>Open <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">id.atlassian.com → API tokens</a>.</li>
             <li>Click <strong>Create API token</strong>, name it "CostFlow", and copy it.</li>
             <li>Paste it above along with your Jira site URL and the email for that Atlassian account.</li>
           </ol>`,
  pickerBlurb: 'Jira Cloud projects: issues, statuses, assignees, and full workflow history.',
  // The changelog gives ordered, timestamped status transitions for every
  // issue, on every plan tier — which is why the wait-based diagnostics work
  // here and not everywhere.
  provides: {
    canProvide: ['stage-snapshots', 'status-history', 'transition-history', 'due-dates'],
    planGated: [],
    planGateHint: {},
  },
};

/**
 * Build the Jira connector around a gateway (production: HttpJiraGateway;
 * tests: a stub). Everything except the gateway is pure.
 */
/**
 * SSRF guard for the user-supplied Jira site URL: the server fetches this URL
 * with credentials attached, so it must never point inside our own network.
 * Rejects loopback/private/link-local/CGNAT IP literals, reserved internal
 * hostnames, and URLs carrying embedded credentials. String-level only — DNS
 * rebinding (a public name resolving to a private address) is out of scope
 * here and belongs at the network layer.
 */
export function forbiddenJiraSite(site: string): boolean {
  let url: URL;
  try {
    url = new URL(site);
  } catch {
    return true;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return true;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isIpv6 = host.includes(':');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa') ||
    // A bare single-label host ("intranet") is internal — but skip this for
    // IPv6 literals, which legitimately contain no dot.
    (!isIpv6 && !host.includes('.'))
  ) {
    return true;
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIpv6) {
    // IPv6 literal: allow only clearly-global unicast (2000::/3); everything
    // else (loopback ::1, ULA fc00::/7, link-local fe80::/10, v4-mapped) is
    // refused rather than enumerated.
    return !/^[23]/.test(host);
  }
  return false;
}

export function buildJiraConnector(gateway: ConnectorGateway): Connector {
  return {
    descriptor: JIRA_DESCRIPTOR,

    gateway,

    parseConnectForm(body) {
      const site = String(body['site'] ?? '')
        .trim()
        .replace(/\/$/, '');
      const email = String(body['email'] ?? '').trim();
      const token = String(body['token'] ?? '').trim();
      if (!/^https:\/\/[^\s]+$/.test(site) || !email || !token) {
        return {
          ok: false,
          error:
            'All three fields are required, and the site must be an https:// URL, for example <code>https://your-org.atlassian.net</code>.',
        };
      }
      if (forbiddenJiraSite(site)) {
        return {
          ok: false,
          error:
            'The site must be a public https:// URL, for example <code>https://your-org.atlassian.net</code>.',
        };
      }
      return { ok: true, params: { site, email }, secret: token };
    },

    describeConnection(params: ConnectionParams): string {
      return `Jira site ${params['site'] ?? ''}, connected as ${params['email'] ?? ''}`;
    },

    observe(raw: RawFetch): ObservedWorkspace {
      const { searchPages } = asJiraRaw(raw);
      const observed = observeJiraSearchPages(searchPages);
      // Item count for the reliability ceiling: `total` is authoritative from
      // Jira's first page; fall back to counting embedded issues if absent.
      const itemCount = ((): number => {
        try {
          const first = JSON.parse(searchPages[0] ?? '{}') as {
            total?: number;
            issues?: unknown[];
          };
          if (typeof first.total === 'number') return first.total;
        } catch {
          /* fall through to counting */
        }
        return searchPages.reduce((acc, p) => {
          try {
            return acc + ((JSON.parse(p) as { issues?: unknown[] }).issues?.length ?? 0);
          } catch {
            return acc;
          }
        }, 0);
      })();
      const statusHints: Record<string, StageKind> = {};
      for (const status of observed.statuses) {
        const guess = guessStageKind(status);
        if (guess !== null) statusHints[status] = guess;
      }
      return { statuses: observed.statuses, actors: observed.actors, statusHints, itemCount };
    },

    buildBatch(input: BuildBatchInput): ImportBatch {
      const raw = asJiraRaw(input.raw);
      return transformJira({
        batchId: input.batchId,
        searchPages: raw.searchPages,
        supplementaryChangelogs: raw.supplementaryChangelogs,
        mapping: {
          id: input.mappingId,
          version: input.mappingVersion,
          statusMap: input.statusMap,
          ...(input.actorRoleMap ? { actorRoleMap: input.actorRoleMap } : {}),
        },
        scope: input.scope,
        importedAt: input.importedAt,
        pseudonymization: input.pseudonymization,
      });
    },
  };
}
