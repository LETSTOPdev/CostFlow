import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import { marked } from 'marked';
import type { AssumptionSet, Provenance, RangeSpec, StageKind } from '@costflow/domain';
import { STAGE_KINDS } from '@costflow/domain';
import { observeJiraSearchPages } from '@costflow/ingestion';
import { countProvenance, nextProvenance, vendorSeededAssumptions } from './assumptions';
import {
  clearSession,
  registerAuthRoutes,
  sessionFrom,
  type AuthConfig,
  type Session,
} from './auth';
import { decryptSecret, encryptSecret } from './crypto';
import { esc, layout, STEPS_NAV } from './html';
import { executeJob } from './jobs';
import { GatewayError, type JiraGateway } from './jira-gateway';
import { registerSecurity } from './security';
import {
  onboardingRank,
  type OnboardingState,
  type Store,
  type WorkspaceRecord,
} from './store/contract';
import { webEvent, type TelemetrySink } from './telemetry-web';

/**
 * The web application shell (doc 09 P4.1): server-rendered onboarding wizard
 * → job execution → persisted report view. Every route is tenant-scoped via
 * the session; every POST checks the per-session CSRF token; provider tokens
 * are decrypted only where the plan allows (§2).
 */

export interface ServerDeps {
  readonly store: Store;
  readonly gateway: JiraGateway;
  readonly auth: AuthConfig;
  readonly telemetry: TelemetrySink;
  /** Deterministic job time for tests; production uses the wall clock. */
  readonly jobNowFn?: () => string;
  /** Await job completion inside POST /runs (tests + small workspaces). */
  readonly awaitJobs?: boolean;
  /** Production posture: strict HSTS + Fastify trustProxy for the edge. */
  readonly production?: boolean;
  readonly trustProxy?: boolean;
  /** Injected structured log sink (tests capture it); defaults to stdout JSON. */
  readonly logSink?: (line: Record<string, unknown>) => void;
}

const PROVENANCE_LABEL: Record<Provenance, string> = {
  'vendor-suggested': 'vendor suggested — not used in pricing until you accept or customize it',
  'customer-accepted': 'accepted by you',
  'customer-customized': 'customized by you',
  'customer-measured': 'measured',
};

const DECIMAL = /^\d+(\.\d+)?$/;

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { store, gateway, auth, telemetry } = deps;
  const app = Fastify({ trustProxy: deps.trustProxy === true });
  void app.register(fastifyCookie);
  void app.register(fastifyFormbody);

  registerSecurity(app, {
    production: deps.production === true,
    store,
    ...(deps.logSink ? { logSink: deps.logSink } : {}),
  });

  registerAuthRoutes(app, auth, store, (ok) => telemetry(webEvent('tm-web-signin', { ok })));

  app.post('/logout', async (request, reply) => {
    const session = sessionFrom(request, auth.sessionKey);
    if (session && (request.body as { csrf?: string })?.csrf !== session.csrf) {
      return reply.code(403).send('Invalid CSRF token.');
    }
    clearSession(reply, auth.secureCookies === true);
    return reply.redirect('/login');
  });

  const requireSession = (request: FastifyRequest, reply: FastifyReply): Session | null => {
    const session = sessionFrom(request, auth.sessionKey);
    if (!session) void reply.redirect('/login');
    return session;
  };

  const checkCsrf = (request: FastifyRequest, session: Session, reply: FastifyReply): boolean => {
    const token = (request.body as { csrf?: string })?.csrf;
    if (token !== session.csrf) {
      void reply.code(403).send('Invalid CSRF token.');
      return false;
    }
    return true;
  };

  const csrfField = (session: Session): string =>
    `<input type="hidden" name="csrf" value="${esc(session.csrf)}">`;

  const soleWorkspace = async (session: Session): Promise<WorkspaceRecord | null> => {
    const workspaces = await store.listWorkspaces(session.tenantId);
    return workspaces[0] ?? null;
  };

  const requireStep = async (
    session: Session,
    reply: FastifyReply,
    minimum: OnboardingState,
  ): Promise<WorkspaceRecord | null> => {
    const workspace = await soleWorkspace(session);
    if (!workspace) {
      void reply.redirect('/connect');
      return null;
    }
    if (onboardingRank(workspace.onboarding) < onboardingRank(minimum)) {
      void reply.redirect('/');
      return null;
    }
    return workspace;
  };

  const nextStepPath = (workspace: WorkspaceRecord): string => {
    switch (workspace.onboarding) {
      case 'connected':
        return '/scope';
      case 'scope-selected':
        return '/mapping/statuses';
      case 'statuses-mapped':
        return '/mapping/actors';
      case 'actors-mapped':
        return '/assumptions';
      default:
        return '/dashboard';
    }
  };

  const connection = (workspace: WorkspaceRecord) => ({
    site: workspace.site,
    email: workspace.email,
    token: decryptSecret(workspace.tokenCiphertext, auth.credentialKey),
  });

  // ---------- home / dashboard ----------

  app.get('/', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const workspace = await soleWorkspace(session);
    if (!workspace) return reply.redirect('/connect');
    return reply.redirect(nextStepPath(workspace));
  });

  app.get('/dashboard', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const workspace = await requireStep(session, reply, 'assumptions-set');
    if (!workspace) return;
    const runs = await store.listRuns(session.tenantId);
    const jobs = await store.listJobsForWorkspace(session.tenantId, workspace.id);
    const failed = jobs.filter((j) => j.status === 'failed').slice(-3);
    return reply.type('text/html').send(
      layout(
        'Dashboard',
        `${STEPS_NAV}
         <h2>${esc(workspace.projectName ?? '')} (${esc(workspace.projectKey ?? '')})</h2>
         <p class="note">Jira site ${esc(workspace.site)} · connected as ${esc(workspace.email)} · credentials stored encrypted</p>
         <form method="post" action="/runs">${csrfField(session)}<button type="submit">Run CostFlow</button></form>
         ${
           failed.length > 0
             ? `<h3>Recent failures</h3><ul>${failed
                 .map(
                   (j) =>
                     `<li>${esc(j.createdAt)} — ${esc(j.errorClass ?? '')}: ${esc(j.errorMessage ?? '')}</li>`,
                 )
                 .join('')}</ul>`
             : ''
         }
         <h3>Runs</h3>
         ${
           runs.length === 0
             ? '<p class="note">No runs yet.</p>'
             : `<ul>${runs
                 .map(
                   (r) =>
                     `<li><a href="/reports/${esc(r.id)}">${esc(r.createdAt)} — run ${esc(r.id)}</a></li>`,
                 )
                 .join('')}</ul>`
         }
         <p><a href="/connect">Connection</a> · <a href="/scope">Scope</a> · <a href="/mapping/statuses">Statuses</a> · <a href="/mapping/actors">Roles</a> · <a href="/assumptions">Assumptions</a></p>
         <form method="post" action="/logout">${csrfField(session)}<button type="submit">Sign out</button></form>`,
      ),
    );
  });

  // ---------- step 1: connect ----------

  app.get('/connect', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const workspace = await soleWorkspace(session);
    return reply.type('text/html').send(
      layout(
        'Connect Jira',
        `${STEPS_NAV}
         <h2>Connect your Jira workspace</h2>
         ${workspace ? `<p class="note">Connected to ${esc(workspace.site)} as ${esc(workspace.email)}. Submitting replaces the stored credentials.</p>` : ''}
         <form method="post" action="/connect">${csrfField(session)}
           <label>Jira site URL <input name="site" placeholder="https://your-org.atlassian.net" required value="${esc(workspace?.site ?? '')}"></label>
           <label>Account email <input name="email" type="email" required value="${esc(workspace?.email ?? '')}"></label>
           <label>API token <input name="token" type="password" required autocomplete="off"></label>
           <p class="note">The token is encrypted at rest and never shown again. CostFlow reads only.</p>
           <button type="submit">Validate &amp; connect</button>
         </form>`,
      ),
    );
  });

  app.post('/connect', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const body = request.body as { site?: string; email?: string; token?: string };
    const site = (body.site ?? '').trim().replace(/\/$/, '');
    const email = (body.email ?? '').trim();
    const token = (body.token ?? '').trim();
    if (!/^https:\/\/[^\s]+$/.test(site) || !email || !token) {
      telemetry(
        webEvent('tm-web-workspace-connected', {
          provider: 'jira',
          ok: false,
          errorClass: 'cli-error',
        }),
      );
      return reply
        .code(400)
        .type('text/html')
        .send(
          layout(
            'Connect Jira',
            `<p class="error">Site (https URL), email, and token are all required.</p>`,
          ),
        );
    }
    try {
      await gateway.listProjects({ site, email, token });
    } catch (error) {
      const errorClass = error instanceof GatewayError ? error.errorClass : 'unexpected';
      telemetry(
        webEvent('tm-web-workspace-connected', { provider: 'jira', ok: false, errorClass }),
      );
      return reply
        .code(400)
        .type('text/html')
        .send(
          layout(
            'Connect Jira',
            `<p class="error">Connection failed (${esc(errorClass)}): ${esc(
              error instanceof GatewayError ? error.message : 'unexpected error',
            )}</p><p><a href="/connect">Try again</a></p>`,
          ),
        );
    }
    const tokenCiphertext = encryptSecret(token, auth.credentialKey);
    const existing = await soleWorkspace(session);
    if (existing) {
      await store.updateWorkspace(session.tenantId, existing.id, { tokenCiphertext });
    } else {
      await store.createWorkspace(session.tenantId, {
        provider: 'jira',
        site,
        email,
        tokenCiphertext,
      });
    }
    telemetry(
      webEvent('tm-web-workspace-connected', { provider: 'jira', ok: true, errorClass: null }),
    );
    return reply.redirect('/scope');
  });

  // ---------- step 2: scope (project selection) ----------

  app.get('/scope', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const workspace = await requireStep(session, reply, 'connected');
    if (!workspace) return;
    let projects;
    try {
      projects = await gateway.listProjects(connection(workspace));
    } catch (error) {
      const errorClass = error instanceof GatewayError ? error.errorClass : 'unexpected';
      return reply
        .type('text/html')
        .send(
          layout(
            'Choose scope',
            `<p class="error">Could not list projects (${esc(errorClass)}). <a href="/connect">Check the connection.</a></p>`,
          ),
        );
    }
    return reply.type('text/html').send(
      layout(
        'Choose scope',
        `${STEPS_NAV}
         <h2>Choose the project to import</h2>
         <form method="post" action="/scope">${csrfField(session)}
           ${projects
             .map(
               (p, index) =>
                 `<label><input type="radio" name="project" value="${index}" ${
                   workspace.projectKey === p.key ? 'checked' : ''
                 } required> ${esc(p.name)} (${esc(p.key)})</label>`,
             )
             .join('')}
           <button type="submit">Import this project</button>
         </form>`,
      ),
    );
  });

  app.post('/scope', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const workspace = await requireStep(session, reply, 'connected');
    if (!workspace) return;
    const conn = connection(workspace);
    const projects = await gateway.listProjects(conn);
    const index = Number((request.body as { project?: string }).project);
    const project = projects[index];
    if (!project) {
      return reply.code(400).send('Unknown project selection.');
    }
    let observed;
    try {
      const { searchPages } = await gateway.fetchAll(conn, project.key);
      observed = observeJiraSearchPages(searchPages);
    } catch (error) {
      const errorClass = error instanceof GatewayError ? error.errorClass : 'unexpected';
      return reply
        .code(400)
        .type('text/html')
        .send(layout('Choose scope', `<p class="error">Import failed (${esc(errorClass)}).</p>`));
    }
    await store.updateWorkspace(session.tenantId, workspace.id, {
      projectKey: project.key,
      projectName: project.name,
      observedStatuses: observed.statuses,
      observedActors: observed.actors,
      onboarding:
        onboardingRank(workspace.onboarding) > onboardingRank('scope-selected')
          ? workspace.onboarding
          : 'scope-selected',
    });
    telemetry(webEvent('tm-web-scope-selected', { provider: 'jira' }));
    return reply.redirect('/mapping/statuses');
  });

  // ---------- step 3: status mapping ----------

  app.get('/mapping/statuses', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const workspace = await requireStep(session, reply, 'scope-selected');
    if (!workspace) return;
    const kinds = STAGE_KINDS.map((k) => `<option value="${k}">${k}</option>`).join('');
    return reply.type('text/html').send(
      layout(
        'Map statuses',
        `${STEPS_NAV}
         <h2>Map every status to a stage kind</h2>
         <p class="note">All ${workspace.observedStatuses.length} statuses observed in the project (current and historical) must be mapped — history through an unmapped status would make the analysis refuse.</p>
         <form method="post" action="/mapping/statuses">${csrfField(session)}
           <table><tr><th>Status in Jira</th><th>Stage kind</th></tr>
           ${workspace.observedStatuses
             .map(
               (status, index) =>
                 `<tr><td>${esc(status)}</td><td><select name="s${index}" required>
                    <option value="" ${workspace.statusMap?.[status] === undefined ? 'selected' : ''} disabled>choose…</option>
                    ${STAGE_KINDS.map(
                      (k) =>
                        `<option value="${k}" ${workspace.statusMap?.[status] === k ? 'selected' : ''}>${k}</option>`,
                    ).join('')}
                  </select></td></tr>`,
             )
             .join('')}
           </table>
           ${kinds.length === 0 ? '' : ''}
           <button type="submit">Save status mapping</button>
         </form>`,
      ),
    );
  });

  app.post('/mapping/statuses', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const workspace = await requireStep(session, reply, 'scope-selected');
    if (!workspace) return;
    const body = request.body as Record<string, string>;
    const statusMap: Record<string, StageKind> = {};
    for (let index = 0; index < workspace.observedStatuses.length; index += 1) {
      const status = workspace.observedStatuses[index] as string;
      const kind = body[`s${index}`];
      if (!STAGE_KINDS.includes(kind as StageKind)) {
        return reply
          .code(400)
          .send(`Every status needs a stage kind (missing: position ${index}).`);
      }
      statusMap[status] = kind as StageKind;
    }
    await store.updateWorkspace(session.tenantId, workspace.id, {
      statusMap,
      onboarding:
        onboardingRank(workspace.onboarding) > onboardingRank('statuses-mapped')
          ? workspace.onboarding
          : 'statuses-mapped',
    });
    telemetry(
      webEvent('tm-web-statuses-mapped', {
        mapped: Object.keys(statusMap).length,
        droppedCandidates: workspace.observedStatuses.length - Object.keys(statusMap).length,
      }),
    );
    return reply.redirect('/mapping/actors');
  });

  // ---------- step 4: actor → role mapping ----------

  app.get('/mapping/actors', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const workspace = await requireStep(session, reply, 'statuses-mapped');
    if (!workspace) return;
    return reply.type('text/html').send(
      layout(
        'Map people to roles',
        `${STEPS_NAV}
         <h2>Map people to roles</h2>
         <p class="note">Role names (e.g. "Legal", "Ops") price work by rate card. Anyone left blank is
         pseudonymized — never stored by name — and priced at the default rate with reduced confidence.</p>
         <form method="post" action="/mapping/actors">${csrfField(session)}
           <table><tr><th>Person (from Jira)</th><th>Role (blank = pseudonymize)</th></tr>
           ${workspace.observedActors
             .map(
               (actor, index) =>
                 `<tr><td>${esc(actor)}</td><td><input name="a${index}" value="${esc(
                   workspace.actorRoleMap?.[actor] ?? '',
                 )}"></td></tr>`,
             )
             .join('')}
           </table>
           <button type="submit">Save role mapping</button>
         </form>`,
      ),
    );
  });

  app.post('/mapping/actors', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const workspace = await requireStep(session, reply, 'statuses-mapped');
    if (!workspace) return;
    const body = request.body as Record<string, string>;
    const actorRoleMap: Record<string, string> = {};
    workspace.observedActors.forEach((actor, index) => {
      const role = (body[`a${index}`] ?? '').trim();
      if (role !== '') actorRoleMap[actor] = role;
    });
    await store.updateWorkspace(session.tenantId, workspace.id, {
      actorRoleMap,
      onboarding:
        onboardingRank(workspace.onboarding) > onboardingRank('actors-mapped')
          ? workspace.onboarding
          : 'actors-mapped',
    });
    telemetry(
      webEvent('tm-web-actors-mapped', {
        mappedToRoles: Object.keys(actorRoleMap).length,
        unmapped: workspace.observedActors.length - Object.keys(actorRoleMap).length,
      }),
    );
    return reply.redirect('/assumptions');
  });

  // ---------- step 5: assumptions (four-state provenance) ----------

  const rolesOf = (workspace: WorkspaceRecord): string[] =>
    [...new Set(Object.values(workspace.actorRoleMap ?? {}))].sort();

  const baselineAssumptions = (workspace: WorkspaceRecord): AssumptionSet => {
    const roles = rolesOf(workspace);
    const seeded = vendorSeededAssumptions(workspace.id, roles);
    const previous = workspace.assumptions;
    if (!previous) return seeded;
    // Reconcile role list changes: keep owned entries, seed new roles vendor.
    return {
      ...previous,
      rates: roles.map(
        (roleRef) =>
          previous.rates.find((r) => r.roleRef === roleRef) ?? {
            roleRef,
            hourlyRate: seeded.defaultRate.hourlyRate,
            provenance: 'vendor-suggested' as const,
          },
      ),
    };
  };

  const rangeInputs = (name: string, range: RangeSpec): string =>
    `<input name="${name}_low" size="6" value="${esc(range.low)}"> –
     <input name="${name}_expected" size="6" value="${esc(range.expected)}"> –
     <input name="${name}_high" size="6" value="${esc(range.high)}"> h/day`;

  const acceptBox = (name: string, provenance: Provenance): string =>
    provenance === 'vendor-suggested'
      ? `<label><input type="checkbox" name="accept_${name}"> Accept this value</label>`
      : '';

  app.get('/assumptions', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const workspace = await requireStep(session, reply, 'actors-mapped');
    if (!workspace) return;
    const current = baselineAssumptions(workspace);
    const row = (
      label: string,
      provenance: Provenance,
      controls: string,
      acceptName: string,
    ): string =>
      `<tr><td>${esc(label)}</td><td>${controls}</td>
       <td class="note">${esc(PROVENANCE_LABEL[provenance])}<br>${acceptBox(acceptName, provenance)}</td></tr>`;
    return reply.type('text/html').send(
      layout(
        'Assumptions',
        `${STEPS_NAV}
         <h2>Assumptions (currency: ${esc(current.currency)})</h2>
         <p class="note">Nothing is priced on a vendor suggestion: accept a value as yours, or change
         it. Unconfirmed assumptions leave their frictions unpriced in reports.</p>
         <form method="post" action="/assumptions">${csrfField(session)}
           <table><tr><th>Assumption</th><th>Value</th><th>Status</th></tr>
           ${current.rates
             .map((rate, index) =>
               row(
                 `Hourly rate — ${rate.roleRef}`,
                 rate.provenance,
                 `<input name="rate${index}" size="8" value="${esc(rate.hourlyRate)}"> ${esc(current.currency)}/h`,
                 `rate${index}`,
               ),
             )
             .join('')}
           ${row(
             'Default hourly rate (unmapped people, roles without a rate)',
             current.defaultRate.provenance,
             `<input name="defaultRate" size="8" value="${esc(current.defaultRate.hourlyRate)}"> ${esc(current.currency)}/h`,
             'defaultRate',
           )}
           ${row(
             'Aging threshold (days untouched before an item counts as aging)',
             current.parameters.agingThresholdDays.provenance,
             `<input name="agingThresholdDays" size="4" value="${current.parameters.agingThresholdDays.value}"> days`,
             'agingThresholdDays',
           )}
           ${row(
             'Attention on aging items (hours/day, low–expected–high)',
             current.parameters.attentionHoursPerDay.provenance,
             rangeInputs('attention', current.parameters.attentionHoursPerDay.range),
             'attention',
           )}
           ${row(
             'Follow-up attention on queued items (hours/day)',
             current.parameters.queueWaitAttentionHoursPerDay?.provenance ?? 'vendor-suggested',
             rangeInputs(
               'queueWait',
               current.parameters.queueWaitAttentionHoursPerDay?.range ?? {
                 low: '0',
                 expected: '0',
                 high: '0',
               },
             ),
             'queueWait',
           )}
           ${row(
             'Chasing attention on overdue items (hours/day)',
             current.parameters.overdueAttentionHoursPerDay?.provenance ?? 'vendor-suggested',
             rangeInputs(
               'overdue',
               current.parameters.overdueAttentionHoursPerDay?.range ?? {
                 low: '0',
                 expected: '0',
                 high: '0',
               },
             ),
             'overdue',
           )}
           </table>
           <button type="submit">Save assumptions</button>
         </form>`,
      ),
    );
  });

  app.post('/assumptions', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const workspace = await requireStep(session, reply, 'actors-mapped');
    if (!workspace) return;
    const previous = baselineAssumptions(workspace);
    const body = request.body as Record<string, string | undefined>;

    const readDecimal = (name: string): string | null => {
      const raw = (body[name] ?? '').trim();
      return DECIMAL.test(raw) ? raw : null;
    };
    const accepted = (name: string): boolean => body[`accept_${name}`] !== undefined;

    const invalid: string[] = [];
    const scalar = (name: string, previousValue: string): { value: string; changed: boolean } => {
      const value = readDecimal(name);
      if (value === null) {
        invalid.push(name);
        return { value: previousValue, changed: false };
      }
      return { value, changed: value !== previousValue };
    };
    const range = (
      name: string,
      previousRange: RangeSpec,
    ): { range: RangeSpec; changed: boolean } => {
      const low = readDecimal(`${name}_low`);
      const expected = readDecimal(`${name}_expected`);
      const high = readDecimal(`${name}_high`);
      if (low === null || expected === null || high === null) {
        invalid.push(name);
        return { range: previousRange, changed: false };
      }
      const next = { low, expected, high };
      return {
        range: next,
        changed:
          low !== previousRange.low ||
          expected !== previousRange.expected ||
          high !== previousRange.high,
      };
    };

    const rates = previous.rates.map((rate, index) => {
      const { value, changed } = scalar(`rate${index}`, rate.hourlyRate);
      return {
        roleRef: rate.roleRef,
        hourlyRate: value,
        provenance: nextProvenance(rate.provenance, changed, accepted(`rate${index}`)),
      };
    });
    const defaultRateInput = scalar('defaultRate', previous.defaultRate.hourlyRate);
    const agingRaw = (body['agingThresholdDays'] ?? '').trim();
    const agingValue = /^\d+$/.test(agingRaw) ? Number(agingRaw) : null;
    if (agingValue === null) invalid.push('agingThresholdDays');
    const attention = range('attention', previous.parameters.attentionHoursPerDay.range);
    const queueWait = range(
      'queueWait',
      previous.parameters.queueWaitAttentionHoursPerDay?.range ?? {
        low: '0',
        expected: '0',
        high: '0',
      },
    );
    const overdue = range(
      'overdue',
      previous.parameters.overdueAttentionHoursPerDay?.range ?? {
        low: '0',
        expected: '0',
        high: '0',
      },
    );

    if (invalid.length > 0) {
      return reply
        .code(400)
        .type('text/html')
        .send(
          layout(
            'Assumptions',
            `<p class="error">Invalid value(s) for: ${esc(invalid.join(', '))} — non-negative decimals only.</p>
             <p><a href="/assumptions">Back</a></p>`,
          ),
        );
    }

    const agingChanged = agingValue !== previous.parameters.agingThresholdDays.value;
    const next: AssumptionSet = {
      id: previous.id,
      version: workspace.assumptions ? String(Number(workspace.assumptions.version) + 1) : '1',
      currency: previous.currency,
      rates,
      defaultRate: {
        hourlyRate: defaultRateInput.value,
        provenance: nextProvenance(
          previous.defaultRate.provenance,
          defaultRateInput.changed,
          accepted('defaultRate'),
        ),
      },
      parameters: {
        agingThresholdDays: {
          value: agingValue as number,
          provenance: nextProvenance(
            previous.parameters.agingThresholdDays.provenance,
            agingChanged,
            accepted('agingThresholdDays'),
          ),
        },
        attentionHoursPerDay: {
          range: attention.range,
          provenance: nextProvenance(
            previous.parameters.attentionHoursPerDay.provenance,
            attention.changed,
            accepted('attention'),
          ),
        },
        queueWaitAttentionHoursPerDay: {
          range: queueWait.range,
          provenance: nextProvenance(
            previous.parameters.queueWaitAttentionHoursPerDay?.provenance ?? 'vendor-suggested',
            queueWait.changed,
            accepted('queueWait'),
          ),
        },
        overdueAttentionHoursPerDay: {
          range: overdue.range,
          provenance: nextProvenance(
            previous.parameters.overdueAttentionHoursPerDay?.provenance ?? 'vendor-suggested',
            overdue.changed,
            accepted('overdue'),
          ),
        },
      },
    };

    await store.updateWorkspace(session.tenantId, workspace.id, {
      assumptions: next,
      onboarding:
        onboardingRank(workspace.onboarding) > onboardingRank('assumptions-set')
          ? workspace.onboarding
          : 'assumptions-set',
    });
    const counts = countProvenance(next);
    telemetry(
      webEvent('tm-web-assumptions-confirmed', {
        accepted: counts['customer-accepted'],
        customized: counts['customer-customized'],
        vendorRemaining: counts['vendor-suggested'],
      }),
    );
    return reply.redirect('/dashboard');
  });

  // ---------- run + report ----------

  app.post('/runs', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const workspace = await requireStep(session, reply, 'assumptions-set');
    if (!workspace) return;
    const job = await store.createJob(session.tenantId, workspace.id);
    const startedMs = Date.now();
    const execution = executeJob(
      {
        store,
        gateway,
        credentialKey: auth.credentialKey,
        ...(deps.jobNowFn ? { nowFn: deps.jobNowFn } : {}),
      },
      session.tenantId,
      job.id,
    ).then(async () => {
      const finished = await store.getJob(session.tenantId, job.id);
      telemetry(
        webEvent('tm-web-run', {
          provider: 'jira',
          ok: finished?.status === 'succeeded',
          errorClass: finished?.errorClass ?? null,
          durationMs: Date.now() - startedMs,
        }),
      );
    });
    if (deps.awaitJobs === true) {
      await execution;
    } else {
      void execution;
    }
    return reply.redirect(`/jobs/${job.id}`);
  });

  app.get('/jobs/:jobId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const jobId = (request.params as { jobId: string }).jobId;
    const job = await store.getJob(session.tenantId, jobId);
    if (!job) return reply.code(404).send('Not found.');
    if (job.status === 'succeeded' && job.runId) {
      return reply.redirect(`/reports/${job.runId}`);
    }
    if (job.status === 'failed') {
      return reply.type('text/html').send(
        layout(
          'Run failed',
          `<h2>Run failed</h2>
           <p class="error">${esc(job.errorClass ?? 'unexpected')}: ${esc(job.errorMessage ?? '')}</p>
           <form method="post" action="/runs">${csrfField(session)}<button type="submit">Run again</button></form>`,
        ),
      );
    }
    return reply.type('text/html').send(
      `<!doctype html><meta http-equiv="refresh" content="2"><title>Running…</title>
       <p>Analysis ${esc(job.status)}… this page refreshes automatically.</p>`,
    );
  });

  app.get('/runs', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const runs = await store.listRuns(session.tenantId);
    return reply
      .type('text/html')
      .send(
        layout(
          'Runs',
          runs.length === 0
            ? '<p class="note">No runs yet.</p>'
            : `<ul>${runs
                .map(
                  (r) =>
                    `<li><a href="/reports/${esc(r.id)}">${esc(r.createdAt)} — run ${esc(r.id)}</a></li>`,
                )
                .join('')}</ul>`,
        ),
      );
  });

  app.get('/reports/:runId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const runId = (request.params as { runId: string }).runId;
    const run = await store.getRun(session.tenantId, runId);
    if (!run) return reply.code(404).send('Not found.');
    const nowIso = new Date(Date.now()).toISOString();
    const firstView = await store.markRunViewed(session.tenantId, runId, nowIso);
    telemetry(webEvent('tm-web-report-viewed', { firstView }));
    const html = await marked.parse(run.reportMd);
    return reply.type('text/html').send(layout(`Report ${run.id}`, `<article>${html}</article>`));
  });

  return app;
}
