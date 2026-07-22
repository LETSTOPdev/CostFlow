import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import { marked } from 'marked';
import type { AssumptionSet, Provenance, RangeSpec, StageKind } from '@costflow/domain';
import { STAGE_KINDS } from '@costflow/domain';
import { observeJiraSearchPages } from '@costflow/ingestion';
import { countProvenance, nextProvenance, vendorSeededAssumptions } from './assumptions';
import { findIndividualAttribution } from './attribution';
import {
  clearSession,
  INVITE_COOKIE,
  oidcLogoutUrl,
  registerAuthRoutes,
  sessionFrom,
  type AuthConfig,
  type Session,
} from './auth';
import type { AnalysisRun } from '@costflow/analysis';
import { decryptSecret, encryptSecret, newId, signValue } from './crypto';
import { esc, layout, METHODOLOGY_APPENDIX, printLayout, stepsNav, STEPS_NAV } from './html';
import { LOGO_SVG } from './brand';
import { renderLanding, renderPrivacy, renderTerms } from './landing';
import { parseRun, renderReportBody } from './report-view';
import { executeJob } from './jobs';
import { GatewayError, type JiraGateway } from './jira-gateway';
import { registerSecurity } from './security';
import {
  onboardingRank,
  ORG_ROLES,
  type OrgRole,
  type OnboardingState,
  type RunRecord,
  type Store,
  type UserRecord,
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
  /** Emails allowed to view the founder analytics page (v1). */
  readonly adminEmails?: string[];
}

// Committed snapshot of the demo-jira golden run.json, shipped in the image
// (Docker copies apps/, not tools/). Public /demo renders it so a visitor
// understands the product before connecting Jira. A static sample is fine — it
// never needs to match the live engine byte-for-byte.
const DEMO_RUN_JSON = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'demo', 'demo-run.json'),
  'utf8',
);

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

  registerAuthRoutes(
    app,
    auth,
    store,
    (ok) => telemetry(webEvent('tm-web-signin', { ok })),
    (role) => telemetry(webEvent('tm-web-invite-accepted', { role })),
  );

  // Clear every auth-bearing cookie (session + in-flight OIDC state). Used by
  // both sign-out and organization erasure so the two paths cannot drift.
  const clearAuthCookies = (reply: FastifyReply): void => {
    clearSession(reply, auth.secureCookies === true);
    reply.clearCookie('cf_oidc_state', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: auth.secureCookies === true,
    });
  };

  app.post('/logout', async (request, reply) => {
    const session = sessionFrom(request, auth.sessionKey);
    const bodyCsrf = (request.body as { csrf?: string })?.csrf;
    // Sanitized structured diagnostics (booleans only — never raw token or
    // session values) so a production logout failure is diagnosable: is the
    // session cookie present, is a csrf field present, does it match?
    logLine({
      level: 'info',
      msg: 'logout-attempt',
      mode: auth.mode,
      session_present: session !== null,
      csrf_present: bodyCsrf !== undefined,
      csrf_match: session ? bodyCsrf === session.csrf : null,
    });
    if (session && bodyCsrf !== session.csrf) {
      return reply.code(403).send('Invalid CSRF token.');
    }
    // Invalidate the local CostFlow session FIRST — always, before any
    // external redirect — so the app cookie is gone regardless of what the
    // IdP does next.
    clearAuthCookies(reply);
    // In OIDC mode, RP-initiated logout: send the browser to Auth0's
    // /oidc/logout to terminate the tenant SSO session, then return to the
    // public /logged-out page. Without this, a protected route silently
    // re-authenticates via the live SSO session (P4.2 Gate 2). In dev mode
    // (no IdP) we land locally.
    if (auth.mode === 'oidc' && auth.oidc) {
      return reply.redirect(oidcLogoutUrl(auth.oidc));
    }
    return reply.redirect('/logged-out');
  });

  // Public, auth-free, OIDC-free post-logout landing.
  app.get('/logged-out', async (_request, reply) => {
    return reply
      .type('text/html')
      .send(
        layout(
          'Signed out',
          '<h2>You have been signed out.</h2><p>Your CostFlow session has ended. <a href="/login">Sign in again</a>.</p>',
        ),
      );
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

  // Authenticated page shell: renders the shared header with a CSRF-protected
  // sign-out control reachable from EVERY authenticated page (connect, scope,
  // mapping, assumptions, dashboard, runs, reports). Unauthenticated pages
  // (dev/OIDC /login) do not use this — no session, no logout control.
  const page = (session: Session, title: string, body: string): string =>
    layout(title, body, session.csrf);

  // ---------- roles & permission enforcement (P4.4) ----------

  const currentUser = (session: Session): Promise<UserRecord | null> =>
    store.getUser(session.tenantId, session.userId);

  const isManager = (user: UserRecord | null): boolean =>
    user !== null && (user.role === 'owner' || user.role === 'admin');

  // Paths that require an owner/admin role. Member-visible surfaces (`/`,
  // `/runs`, `/reports/:id`, auth, logout) are intentionally excluded.
  const managerPath = (method: string, pathname: string): boolean => {
    if (pathname === '/org' || pathname.startsWith('/org/')) return true;
    if (pathname.startsWith('/workspaces/')) return true;
    if (pathname.startsWith('/jobs/')) return true;
    if (pathname === '/settings' || pathname === '/account/delete') return true;
    const onboardingPost = [
      '/connect',
      '/scope',
      '/mapping/statuses',
      '/mapping/actors',
      '/assumptions',
      '/runs',
    ];
    const onboardingGet = [
      '/dashboard',
      '/connect',
      '/scope',
      '/mapping/statuses',
      '/mapping/actors',
      '/assumptions',
    ];
    if (method === 'POST' && onboardingPost.includes(pathname)) return true;
    if (method === 'GET' && onboardingGet.includes(pathname)) return true;
    return false;
  };

  // Coarse role gate: a valid non-manager session on a manager-only path is
  // refused (403). Unauthenticated requests fall through to each route's own
  // /login redirect. Fine-grained rules (owner-only, last-owner protection)
  // live in the individual handlers.
  app.addHook('preHandler', async (request, reply) => {
    const session = sessionFrom(request, auth.sessionKey);
    if (!session) return;
    const pathname = request.url.split('?')[0] ?? request.url;
    if (!managerPath(request.method, pathname)) return;
    const user = await currentUser(session);
    if (!isManager(user)) {
      return reply
        .code(403)
        .type('text/html')
        .send(
          page(
            session,
            'Not allowed',
            '<p class="error">This action requires an owner or admin role. <a href="/runs">Back to your runs</a>.</p>',
          ),
        );
    }
  });

  // Workspaces this session may view: managers see all; members see only the
  // workspaces they belong to.
  const accessibleWorkspaceIds = async (
    session: Session,
    user: UserRecord | null,
  ): Promise<Set<string> | null> => {
    if (isManager(user)) return null; // null = all
    const ids = await store.listWorkspaceIdsForMember(session.tenantId, session.userId);
    return new Set(ids);
  };

  // Sanitized diagnostics for Jira gateway failures (P4.2 defect 2): the
  // stage, error class, and HTTP status — never URLs, credentials, issue
  // titles, actor names, or customer data.
  const logLine =
    deps.logSink ?? ((line: Record<string, unknown>) => console.log(JSON.stringify(line)));
  const jiraFailure = (error: unknown): { errorClass: string; stage: string; status?: number } => {
    if (error instanceof GatewayError) {
      return {
        errorClass: error.errorClass,
        stage: error.stage,
        ...(error.status !== undefined ? { status: error.status } : {}),
      };
    }
    return { errorClass: 'unexpected', stage: 'unknown' };
  };
  const importErrorHtml = (f: { errorClass: string; stage: string; status?: number }): string =>
    `<p class="error">Import failed (${esc(f.errorClass)} at ${esc(f.stage)}${
      f.status !== undefined ? `, HTTP ${f.status}` : ''
    }). <a href="/connect">Check the connection and try again.</a></p>`;

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
    const session = sessionFrom(request, auth.sessionKey);
    // Logged-out visitors get the public marketing landing (v1 free beta).
    if (!session) return reply.type('text/html').send(renderLanding());
    const user = await currentUser(session);
    // Members don't onboard — they land on the runs they can see.
    if (!isManager(user)) return reply.redirect('/runs');
    const workspace = await soleWorkspace(session);
    if (!workspace) return reply.redirect('/connect');
    return reply.redirect(nextStepPath(workspace));
  });

  // Public pages (no session): sample report, Terms, Privacy.
  app.get('/demo', async (_request, reply) => {
    const banner =
      '<p class="note" style="background:#eef6ff;border:1px solid #bcd;padding:0.6rem 0.9rem;border-radius:6px;">' +
      'This is a <strong>sample report</strong> from demo data. <a href="/login">Sign in</a> to run one on your own Jira — free.</p>';
    let body: string;
    try {
      body = renderReportBody(parseRun(DEMO_RUN_JSON), { runId: 'demo' });
    } catch {
      body = '<p class="error">The sample report is temporarily unavailable.</p>';
    }
    const cta =
      '<section class="danger" style="border-color:#0645ad;text-align:center;">' +
      '<h3 style="color:#0645ad;">Ready to see your own?</h3>' +
      '<p class="note">Connect your Jira in about a minute and get a report like this for your team — free.</p>' +
      '<p><a href="/login" style="display:inline-block;background:#0645ad;color:#fff;padding:0.5rem 1.2rem;border-radius:6px;text-decoration:none;font-weight:600;">Get started free</a></p>' +
      '</section>';
    return reply
      .type('text/html')
      .send(
        layout('Sample report — CostFlow', `${banner}${body}${cta}<p><a href="/">← Home</a></p>`),
      );
  });

  // Public brand logo — served so Auth0 Universal Login can render the same
  // CostFlow mark the app header uses (one identity across product + sign-in).
  app.get('/brand/logo.svg', async (_request, reply) =>
    reply.type('image/svg+xml').header('cache-control', 'public, max-age=86400').send(LOGO_SVG),
  );

  app.get('/terms', async (_request, reply) => reply.type('text/html').send(renderTerms()));
  app.get('/privacy', async (_request, reply) => reply.type('text/html').send(renderPrivacy()));

  // Founder-only activation-funnel analytics. Gated by an email allowlist
  // (COSTFLOW_ADMIN_EMAILS); a non-admin session gets 404 (no disclosure).
  app.get('/admin', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const user = await currentUser(session);
    const admins = (deps.adminEmails ?? []).map((email) => email.toLowerCase());
    if (!user || !admins.includes(user.email.toLowerCase())) {
      return reply.code(404).send('Not found.');
    }
    const stats = await store.funnelStats();
    const pct = (n: number, d: number): string => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);
    const row = (label: string, n: number): string =>
      `<tr><td>${label}</td><td>${n}</td><td>${pct(n, stats.organizations)}</td></tr>`;
    return reply.type('text/html').send(
      page(
        session,
        'Admin — activation funnel',
        `<h2>Activation funnel</h2>
         <table><tr><th>Stage</th><th>Organizations</th><th>of signups</th></tr>
           ${row('Signed up', stats.organizations)}
           ${row('Connected a workspace', stats.connectedWorkspaces)}
           ${row('Ran an analysis', stats.analysesRun)}
           ${row('Viewed a report', stats.reportsViewed)}
         </table>
         <p class="note">Aggregate counts of distinct organizations reaching each step. No customer content, emails, or identities.</p>`,
      ),
    );
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
      page(
        session,
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
         <p><a href="/org">Organization &amp; members</a> · <a href="/settings">Settings</a></p>`,
      ),
    );
  });

  // ---------- step 1: connect ----------

  app.get('/connect', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const workspace = await soleWorkspace(session);
    return reply.type('text/html').send(
      page(
        session,
        'Connect Jira',
        `${stepsNav('connect')}
         <h2>Connect your Jira workspace</h2>
         <p class="note">CostFlow reads your Jira with a personal API token — read-only, encrypted at
         rest, and never shown again. It takes about a minute to set up.</p>
         <details>
           <summary>How to get your Jira API token</summary>
           <ol class="note">
             <li>Open <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">id.atlassian.com → API tokens</a>.</li>
             <li>Click <strong>Create API token</strong>, name it "CostFlow", and copy it.</li>
             <li>Paste it below along with your Jira site URL and the email for that Atlassian account.</li>
           </ol>
         </details>
         ${workspace ? `<p class="note">Connected to ${esc(workspace.site)} as ${esc(workspace.email)}. Submitting replaces the stored credentials.</p>` : ''}
         <form method="post" action="/connect">${csrfField(session)}
           <label>Jira site URL <input name="site" placeholder="https://your-org.atlassian.net" required value="${esc(workspace?.site ?? '')}"></label>
           <label>Account email <input name="email" type="email" placeholder="you@company.com" required value="${esc(workspace?.email ?? '')}"></label>
           <label>API token <input name="token" type="password" required autocomplete="off" placeholder="paste your Atlassian API token"></label>
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
          page(
            session,
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
          page(
            session,
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
      const f = jiraFailure(error);
      logLine({ level: 'warn', msg: 'jira-list-projects-failed', ...f });
      return reply.type('text/html').send(page(session, 'Choose scope', importErrorHtml(f)));
    }
    return reply.type('text/html').send(
      page(
        session,
        'Choose scope',
        `${stepsNav('scope')}
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
    let projects;
    try {
      projects = await gateway.listProjects(conn);
    } catch (error) {
      const f = jiraFailure(error);
      logLine({ level: 'warn', msg: 'jira-list-projects-failed', ...f });
      return reply
        .code(400)
        .type('text/html')
        .send(page(session, 'Choose scope', importErrorHtml(f)));
    }
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
      const f = jiraFailure(error);
      logLine({ level: 'warn', msg: 'jira-import-failed', ...f });
      return reply
        .code(400)
        .type('text/html')
        .send(page(session, 'Choose scope', importErrorHtml(f)));
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
      page(
        session,
        'Map statuses',
        `${stepsNav('statuses')}
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
      page(
        session,
        'Map people to roles',
        `${stepsNav('roles')}
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
      page(
        session,
        'Assumptions',
        `${stepsNav('assumptions')}
         <h2>Assumptions (currency: ${esc(current.currency)})</h2>
         <p class="note">Nothing is priced on a vendor suggestion: accept a value as yours, or change
         it. Unconfirmed assumptions leave their frictions unpriced in reports.</p>
         <form method="post" action="/assumptions">${csrfField(session)}
           <p><label><input type="checkbox" name="accept_all"> <strong>Accept all suggested values</strong> — start with our estimates and refine later (you can change any value now).</label></p>
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
    // "Accept all suggested values" accepts every still-vendor-suggested value
    // in one click, so a first-time user reaches a priced report fast.
    const acceptAll = body['accept_all'] !== undefined;
    const accepted = (name: string): boolean => acceptAll || body[`accept_${name}`] !== undefined;

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
          page(
            session,
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
        page(
          session,
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
    const user = await currentUser(session);
    const allowed = await accessibleWorkspaceIds(session, user);
    let runs = await store.listRuns(session.tenantId);
    if (allowed) runs = runs.filter((r) => allowed.has(r.workspaceId));
    return reply
      .type('text/html')
      .send(
        page(
          session,
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

  // Load a run the session may view (tenant-scoped + member workspace check).
  const loadViewableRun = async (
    session: Session,
    runId: string,
    reply: FastifyReply,
  ): Promise<{ record: RunRecord; workspace: WorkspaceRecord | null } | null> => {
    const record = await store.getRun(session.tenantId, runId);
    if (!record) {
      void reply.code(404).send('Not found.');
      return null;
    }
    const viewer = await currentUser(session);
    const allowed = await accessibleWorkspaceIds(session, viewer);
    if (allowed && !allowed.has(record.workspaceId)) {
      void reply.code(404).send('Not found.');
      return null;
    }
    const workspace = await store.getWorkspace(session.tenantId, record.workspaceId);
    return { record, workspace };
  };

  // FR-17 attribution guard (the single reporting-layer choke point, ADR-0002).
  // A correct report is pseudonymized and never names a person; if a raw
  // identity reached the rendered bytes, withhold the whole response. Returns
  // true iff the body is clean (safe to send).
  const attributionOk = (
    body: string,
    workspace: WorkspaceRecord | null,
    session: Session,
    reply: FastifyReply,
  ): boolean => {
    const leaked = findIndividualAttribution(body, workspace?.observedActors ?? []);
    if (leaked.length === 0) return true;
    logLine({
      level: 'error',
      msg: 'attribution-guard-blocked',
      surface: 'report',
      leaked: leaked.length,
    });
    void reply
      .code(500)
      .type('text/html')
      .send(
        page(
          session,
          'Report withheld',
          `<p class="error">This report was withheld: it would attribute cost to a named individual, which CostFlow never does. Nothing was changed. Please contact support.</p>`,
        ),
      );
    return false;
  };

  // The immediately-older run for the same workspace (for the trend section).
  const previousRunFor = async (
    session: Session,
    record: RunRecord,
  ): Promise<AnalysisRun | null> => {
    const runs = await store.listRuns(session.tenantId); // newest first
    const sameWorkspace = runs.filter((r) => r.workspaceId === record.workspaceId);
    const index = sameWorkspace.findIndex((r) => r.id === record.id);
    const older = index >= 0 ? sameWorkspace[index + 1] : undefined;
    return older ? parseRun(older.runJson) : null;
  };

  // Primary: the structured, explorable report view (P5) built from run.json.
  app.get('/reports/:runId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const runId = (request.params as { runId: string }).runId;
    const loaded = await loadViewableRun(session, runId, reply);
    if (!loaded) return;
    // Structured view from run.json; on a malformed/legacy artifact, degrade
    // gracefully to the always-present stored markdown rather than error.
    let body: string;
    let title = `Report ${runId}`;
    try {
      const run = parseRun(loaded.record.runJson);
      const previous = await previousRunFor(session, loaded.record);
      body = renderReportBody(run, { runId: loaded.record.id, previous, printLinks: true });
      title = `Report ${run.runId}`;
    } catch {
      logLine({ level: 'warn', msg: 'report-render-fallback', surface: 'report' });
      body = `<article>${await marked.parse(loaded.record.reportMd)}</article>`;
    }
    if (!attributionOk(body, loaded.workspace, session, reply)) return;
    const nowIso = new Date(Date.now()).toISOString();
    const firstView = await store.markRunViewed(session.tenantId, runId, nowIso);
    telemetry(webEvent('tm-web-report-viewed', { firstView }));
    return reply.type('text/html').send(page(session, title, body));
  });

  // Raw markdown rendering (the engine's report.md), kept as a fallback view.
  app.get('/reports/:runId/raw', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const runId = (request.params as { runId: string }).runId;
    const loaded = await loadViewableRun(session, runId, reply);
    if (!loaded) return;
    const html = await marked.parse(loaded.record.reportMd);
    const body = `<p class="note"><a href="/reports/${esc(loaded.record.id)}">← Structured report</a></p><article>${html}</article>`;
    if (!attributionOk(body, loaded.workspace, session, reply)) return;
    return reply.type('text/html').send(page(session, `Report ${runId} (raw)`, body));
  });

  // Executive print/export: standalone, chrome-free, drill-downs expanded, with
  // a methodology appendix. The user prints to PDF — no PDF binary dependency.
  app.get('/reports/:runId/print', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const runId = (request.params as { runId: string }).runId;
    const loaded = await loadViewableRun(session, runId, reply);
    if (!loaded) return;
    let body: string;
    try {
      const run = parseRun(loaded.record.runJson);
      const previous = await previousRunFor(session, loaded.record);
      body = `${renderReportBody(run, { runId: loaded.record.id, previous, open: true })}${METHODOLOGY_APPENDIX}`;
    } catch {
      logLine({ level: 'warn', msg: 'report-render-fallback', surface: 'print' });
      body = `<article>${await marked.parse(loaded.record.reportMd)}</article>${METHODOLOGY_APPENDIX}`;
    }
    if (!attributionOk(body, loaded.workspace, session, reply)) return;
    return reply.type('text/html').send(printLayout(`Friction report ${runId}`, body));
  });

  // ---------- settings: data & privacy (FR-22 deletion, P4.3) ----------

  const DELETE_WORKSPACE_PHRASE = 'DELETE';
  const DELETE_ACCOUNT_PHRASE = 'DELETE ALL DATA';

  app.get('/settings', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const actor = await currentUser(session);
    const workspaces = await store.listWorkspaces(session.tenantId);
    const workspaceCards = workspaces
      .map(
        (w) =>
          `<div class="danger">
             <h3>${esc(w.projectName ?? 'Unconfigured workspace')} (${esc(w.projectKey ?? w.provider)})</h3>
             <p class="note">Jira site ${esc(w.site)} · deletes this workspace and every run and job derived from it. This cannot be undone.</p>
             <form method="post" action="/workspaces/${esc(w.id)}/delete">${csrfField(session)}
               <label>Type <strong>${DELETE_WORKSPACE_PHRASE}</strong> to confirm <input name="confirm" autocomplete="off" required></label>
               <button type="submit">Delete this workspace's data</button>
             </form>
           </div>`,
      )
      .join('');
    return reply.type('text/html').send(
      page(
        session,
        'Settings',
        `<h2>Data &amp; privacy</h2>
         <p class="note">You control your data. Deleting is permanent and cascades to every
         derived analysis (GDPR erasure). CostFlow keeps no copy.</p>
         ${workspaces.length === 0 ? '<p class="note">No workspaces connected.</p>' : workspaceCards}
         ${
           actor?.role === 'owner'
             ? `<div class="danger">
           <h3>Delete everything</h3>
           <p class="note">Permanently erase your entire organization: all workspaces, runs, jobs,
           every member, and the organization itself. You will be signed out. This cannot be undone.</p>
           <form method="post" action="/account/delete">${csrfField(session)}
             <label>Type <strong>${DELETE_ACCOUNT_PHRASE}</strong> to confirm <input name="confirm" autocomplete="off" required></label>
             <button type="submit">Delete my entire organization</button>
           </form>
         </div>`
             : '<p class="note">Only the organization owner can delete the entire organization.</p>'
         }
         <p><a href="/org">Organization &amp; members</a></p>`,
      ),
    );
  });

  app.post('/workspaces/:workspaceId/delete', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const confirm = ((request.body as { confirm?: string }).confirm ?? '').trim();
    if (confirm !== DELETE_WORKSPACE_PHRASE) {
      return reply
        .code(400)
        .type('text/html')
        .send(
          page(
            session,
            'Settings',
            `<p class="error">Deletion not confirmed — nothing was deleted. Type ${DELETE_WORKSPACE_PHRASE} exactly. <a href="/settings">Back</a></p>`,
          ),
        );
    }
    const summary = await store.deleteWorkspace(session.tenantId, workspaceId);
    if (!summary) return reply.code(404).send('Not found.');
    telemetry(webEvent('tm-web-data-deleted', { scope: 'workspace', cascadedRuns: summary.runs }));
    return reply.redirect('/settings');
  });

  app.post('/account/delete', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    // Erasing the whole organization is owner-only (admins cannot).
    const actor = await currentUser(session);
    if (actor?.role !== 'owner') {
      return reply
        .code(403)
        .type('text/html')
        .send(
          page(
            session,
            'Not allowed',
            '<p class="error">Only the organization owner can delete the entire organization.</p>',
          ),
        );
    }
    const confirm = ((request.body as { confirm?: string }).confirm ?? '').trim();
    if (confirm !== DELETE_ACCOUNT_PHRASE) {
      return reply
        .code(400)
        .type('text/html')
        .send(
          page(
            session,
            'Settings',
            `<p class="error">Deletion not confirmed — nothing was deleted. Type ${esc(DELETE_ACCOUNT_PHRASE)} exactly. <a href="/settings">Back</a></p>`,
          ),
        );
    }
    const summary = await store.deleteTenantData(session.tenantId);
    telemetry(webEvent('tm-web-data-deleted', { scope: 'org', cascadedRuns: summary.runs }));
    // The tenant and user rows are gone; the signed session cookie now points
    // at nothing. Clear it so no dangling session survives, then land on the
    // public post-logout page (local session only — no IdP round-trip here).
    clearAuthCookies(reply);
    return reply.redirect('/logged-out');
  });

  // ---------- organization management (P4.4) ----------

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const orgLabel = (name: string | null): string =>
    name && name.trim() !== '' ? name : 'My organization';
  const countOwners = async (tenantId: string): Promise<number> =>
    (await store.listUsers(tenantId)).filter((u) => u.role === 'owner').length;
  const forbidden = (session: Session, reply: FastifyReply, message: string) =>
    reply
      .code(403)
      .type('text/html')
      .send(
        page(
          session,
          'Not allowed',
          `<p class="error">${esc(message)}</p><p><a href="/org">Back to organization</a></p>`,
        ),
      );
  const orgBadRequest = (session: Session, reply: FastifyReply, message: string) =>
    reply
      .code(400)
      .type('text/html')
      .send(
        page(
          session,
          'Organization',
          `<p class="error">${esc(message)}</p><p><a href="/org">Back</a></p>`,
        ),
      );

  // Public invitation landing: stash the token in a signed cookie and route to
  // sign-in, where it is honored (join the inviting org, not a new one).
  app.get('/invite/:token', async (request, reply) => {
    const token = (request.params as { token: string }).token;
    const invitation = await store.getInvitationByToken(token);
    if (!invitation || invitation.status !== 'pending') {
      return reply
        .type('text/html')
        .send(
          layout(
            'Invitation',
            '<h2>Invitation unavailable</h2><p>This invitation link is invalid, already used, or was revoked. <a href="/login">Sign in</a>.</p>',
          ),
        );
    }
    const tenant = await store.getTenant(invitation.tenantId);
    reply.setCookie(INVITE_COOKIE, signValue({ token }, auth.sessionKey), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: auth.secureCookies === true,
    });
    return reply.type('text/html').send(
      layout(
        'Invitation',
        `<h2>Join ${esc(orgLabel(tenant?.name ?? null))}</h2>
         <p>You have been invited to join as <strong>${esc(invitation.role)}</strong>. Sign in as
         <strong>${esc(invitation.email)}</strong> to accept.</p>
         <p><a href="/login">Continue to sign in</a></p>`,
      ),
    );
  });

  app.get('/org', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const tenant = await store.getTenant(session.tenantId);
    const users = await store.listUsers(session.tenantId);
    const invitations = await store.listInvitations(session.tenantId);
    const workspaces = await store.listWorkspaces(session.tenantId);
    const actor = await currentUser(session);
    const isOwner = actor?.role === 'owner';
    const origin = `${request.protocol}://${request.headers.host ?? ''}`;
    const userById = new Map(users.map((u) => [u.id, u]));

    const roleOptions = (current: OrgRole, allowOwner: boolean): string =>
      ORG_ROLES.filter((r) => allowOwner || r !== 'owner')
        .map((r) => `<option value="${r}" ${r === current ? 'selected' : ''}>${r}</option>`)
        .join('');
    const memberRow = (u: UserRecord): string => {
      const canModify = isOwner || u.role !== 'owner';
      const isSelf = u.id === session.userId;
      const roleControl = canModify
        ? `<form method="post" action="/org/members/${esc(u.id)}/role" class="inline">${csrfField(session)}
             <select name="role">${roleOptions(u.role, isOwner)}</select>
             <button type="submit">Update</button></form>`
        : esc(u.role);
      const removeControl =
        !isSelf && canModify
          ? `<form method="post" action="/org/members/${esc(u.id)}/remove" class="inline">${csrfField(session)}<button type="submit">Remove</button></form>`
          : '';
      return `<tr><td>${esc(u.email)}</td><td>${roleControl}</td><td>${removeControl}</td></tr>`;
    };
    const invRow = (inv: (typeof invitations)[number]): string => {
      const controls =
        inv.status === 'pending'
          ? `<form method="post" action="/org/invitations/${esc(inv.id)}/revoke" class="inline">${csrfField(session)}<button type="submit">Revoke</button></form>`
          : '';
      const linkCell =
        inv.status === 'pending' ? `<code>${esc(`${origin}/invite/${inv.token}`)}</code>` : '';
      return `<tr><td>${esc(inv.email)}</td><td>${esc(inv.role)}</td><td>${esc(inv.status)}</td><td>${linkCell}</td><td>${controls}</td></tr>`;
    };
    const memberIdsByWs = new Map<string, string[]>();
    for (const w of workspaces) {
      memberIdsByWs.set(w.id, await store.listWorkspaceMemberIds(session.tenantId, w.id));
    }
    const wsSection = workspaces
      .map((w) => {
        const memberIds = memberIdsByWs.get(w.id) ?? [];
        const memberList =
          memberIds.length === 0
            ? '<span class="note">No explicit members — owners and admins always have access.</span>'
            : memberIds
                .map((uid) => {
                  const mu = userById.get(uid);
                  return `${esc(mu?.email ?? uid)} <form method="post" action="/workspaces/${esc(w.id)}/members/${esc(uid)}/remove" class="inline">${csrfField(session)}<button type="submit">remove</button></form>`;
                })
                .join('; ');
        const addable = users.filter((u) => !memberIds.includes(u.id));
        const addForm =
          addable.length === 0
            ? ''
            : `<form method="post" action="/workspaces/${esc(w.id)}/members" class="inline">${csrfField(session)}
                 <select name="userId">${addable.map((u) => `<option value="${esc(u.id)}">${esc(u.email)}</option>`).join('')}</select>
                 <button type="submit">Grant access</button></form>`;
        return `<div class="ws"><h4>${esc(w.projectName ?? 'Unconfigured workspace')} (${esc(w.projectKey ?? w.provider)})</h4><p>${memberList}</p>${addForm}</div>`;
      })
      .join('');

    return reply.type('text/html').send(
      page(
        session,
        'Organization',
        `<h2>Organization</h2>
         <p class="note">You are signed in as <strong>${esc(actor?.email ?? '')}</strong> (${esc(actor?.role ?? '')}).</p>

         <h3>Name</h3>
         <form method="post" action="/org/rename">${csrfField(session)}
           <label>Organization name <input name="name" value="${esc(orgLabel(tenant?.name ?? null))}" maxlength="100" required></label>
           <button type="submit">Save name</button>
         </form>

         <h3>Members</h3>
         <table><tr><th>Email</th><th>Role</th><th></th></tr>${users.map(memberRow).join('')}</table>

         <h3>Invitations</h3>
         ${
           invitations.length === 0
             ? '<p class="note">No invitations yet.</p>'
             : `<table><tr><th>Email</th><th>Role</th><th>Status</th><th>Invite link</th><th></th></tr>${invitations.map(invRow).join('')}</table>`
         }
         <form method="post" action="/org/invitations">${csrfField(session)}
           <label>Invite email <input name="email" type="email" required autocomplete="off"></label>
           <label>Role <select name="role"><option value="member">member</option><option value="admin">admin</option></select></label>
           <button type="submit">Create invitation</button>
           <p class="note">Share the generated link with the invitee — they join this organization when they sign in with that email.</p>
         </form>

         <h3>Workspace access</h3>
         <p class="note">Owners and admins can reach every workspace. Members reach only the workspaces granted here.</p>
         ${workspaces.length === 0 ? '<p class="note">No workspaces yet.</p>' : wsSection}

         <p><a href="/dashboard">Dashboard</a> · <a href="/settings">Settings</a></p>`,
      ),
    );
  });

  app.post('/org/rename', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const name = ((request.body as { name?: string }).name ?? '').trim();
    if (name === '' || name.length > 100) {
      return orgBadRequest(session, reply, 'Organization name must be 1–100 characters.');
    }
    await store.updateTenantName(session.tenantId, name);
    telemetry(webEvent('tm-web-org-renamed', {}));
    return reply.redirect('/org');
  });

  app.post('/org/invitations', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const body = request.body as { email?: string; role?: string };
    const email = (body.email ?? '').trim().toLowerCase();
    const role = body.role;
    if (!EMAIL_RE.test(email)) {
      return orgBadRequest(session, reply, 'A valid invite email is required.');
    }
    if (role !== 'admin' && role !== 'member') {
      return orgBadRequest(session, reply, 'Invited role must be admin or member.');
    }
    const existing = await store.findUserByEmail(email);
    if (existing && existing.tenantId === session.tenantId) {
      return orgBadRequest(session, reply, 'That email is already a member of this organization.');
    }
    const token = newId();
    await store.createInvitation(session.tenantId, {
      email,
      role,
      token,
      invitedBy: session.userId,
    });
    telemetry(webEvent('tm-web-member-invited', { role }));
    return reply.redirect('/org');
  });

  app.post('/org/invitations/:id/revoke', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const id = (request.params as { id: string }).id;
    const updated = await store.updateInvitationStatus(session.tenantId, id, 'revoked', null);
    if (!updated) return reply.code(404).send('Not found.');
    telemetry(webEvent('tm-web-invite-revoked', {}));
    return reply.redirect('/org');
  });

  app.post('/org/members/:id/role', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const targetId = (request.params as { id: string }).id;
    const newRole = (request.body as { role?: string }).role;
    if (newRole !== 'owner' && newRole !== 'admin' && newRole !== 'member') {
      return orgBadRequest(session, reply, 'Unknown role.');
    }
    const actor = await currentUser(session);
    const target = await store.getUser(session.tenantId, targetId);
    if (!target) return reply.code(404).send('Not found.');
    if (actor?.role !== 'owner' && (target.role === 'owner' || newRole === 'owner')) {
      return forbidden(session, reply, 'Only the owner can grant or change the owner role.');
    }
    if (
      target.role === 'owner' &&
      newRole !== 'owner' &&
      (await countOwners(session.tenantId)) <= 1
    ) {
      return orgBadRequest(session, reply, 'The organization must always have at least one owner.');
    }
    await store.updateUserRole(session.tenantId, targetId, newRole);
    telemetry(webEvent('tm-web-member-role-changed', { role: newRole }));
    return reply.redirect('/org');
  });

  app.post('/org/members/:id/remove', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const targetId = (request.params as { id: string }).id;
    if (targetId === session.userId) {
      return orgBadRequest(session, reply, 'You cannot remove yourself from the organization.');
    }
    const actor = await currentUser(session);
    const target = await store.getUser(session.tenantId, targetId);
    if (!target) return reply.code(404).send('Not found.');
    if (actor?.role !== 'owner' && target.role === 'owner') {
      return forbidden(session, reply, 'Only the owner can remove an owner.');
    }
    if (target.role === 'owner' && (await countOwners(session.tenantId)) <= 1) {
      return orgBadRequest(session, reply, 'The organization must always have at least one owner.');
    }
    await store.removeUser(session.tenantId, targetId);
    telemetry(webEvent('tm-web-member-removed', {}));
    return reply.redirect('/org');
  });

  app.post('/workspaces/:workspaceId/members', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const userId = (request.body as { userId?: string }).userId ?? '';
    const workspace = await store.getWorkspace(session.tenantId, workspaceId);
    if (!workspace) return reply.code(404).send('Not found.');
    const member = await store.getUser(session.tenantId, userId);
    if (!member) return orgBadRequest(session, reply, 'Unknown member.');
    await store.addWorkspaceMember(session.tenantId, workspaceId, userId);
    telemetry(webEvent('tm-web-workspace-member-added', {}));
    return reply.redirect('/org');
  });

  app.post('/workspaces/:workspaceId/members/:userId/remove', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const { workspaceId, userId } = request.params as { workspaceId: string; userId: string };
    const workspace = await store.getWorkspace(session.tenantId, workspaceId);
    if (!workspace) return reply.code(404).send('Not found.');
    await store.removeWorkspaceMember(session.tenantId, workspaceId, userId);
    telemetry(webEvent('tm-web-workspace-member-removed', {}));
    return reply.redirect('/org');
  });

  return app;
}
