import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import { marked } from 'marked';
import type { AssumptionSet, Provenance, RangeSpec, StageKind } from '@costflow/domain';
import { STAGE_KINDS } from '@costflow/domain';
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
import {
  demoAnalyzingPage,
  esc,
  layout,
  loadingPage,
  METHODOLOGY_APPENDIX,
  printLayout,
  stepsNav,
} from './html';
import { randomDemoSeed, renderDemoCompany } from './demo-live';
import { renderLanding, renderPrivacy, renderTerms } from './landing';
import { renderDashboard } from './dashboard-view';
import { parseRun, renderReportBody, runSummary } from './report-view';
import { executeJob } from './jobs';
import { GatewayError, type ConnectFieldSpec, type Connector } from './connectors/types';
import type { ConnectorRegistry } from './connectors/registry';
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
  readonly connectors: ConnectorRegistry;
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
  /**
   * Reliability ceiling: max issues imported per project. A single very large
   * analysis holds the whole batch + traces in memory (~1GB heap and a ~165MB
   * run.json at 100k issues), so on a shared multi-tenant process an unbounded
   * import can OOM the process and take down every tenant. We refuse above this
   * at import time with a clear message. Default 50,000 covers essentially all
   * real projects; override via COSTFLOW_MAX_ISSUES.
   */
  readonly maxIssues?: number;
}

// Committed snapshot of the demo-jira golden run.json, shipped in the image
// (Docker copies apps/, not tools/). Public /demo renders it so a visitor
// understands the product before connecting Jira. A static sample is fine — it
// never needs to match the live engine byte-for-byte.
const DEMO_RUN_JSON = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'demo', 'demo-run.json'),
  'utf8',
);

// Brand + social-sharing assets (committed binaries, served with long-lived
// caching): the official CostFlow logo set (icon + full wordmark logo, one
// variant per theme), the favicon set, the 1200×630 Open Graph card and the
// iOS home-screen icon. All derived from the official logo masters.
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'assets');
const OG_IMAGE = readFileSync(join(ASSETS_DIR, 'og.jpg'));
const APPLE_TOUCH_ICON = readFileSync(join(ASSETS_DIR, 'apple-touch-icon.png'));
const FAVICON_ICO = readFileSync(join(ASSETS_DIR, 'favicon.ico'));
const ICON_192 = readFileSync(join(ASSETS_DIR, 'icon-192.png'));
const ICON_512 = readFileSync(join(ASSETS_DIR, 'icon-512.png'));
const LOGO_DARK = readFileSync(join(ASSETS_DIR, 'logo-dark.png'));
const LOGO_LIGHT = readFileSync(join(ASSETS_DIR, 'logo-light.png'));
const WEB_MANIFEST = readFileSync(join(ASSETS_DIR, 'site.webmanifest'));

// The official icon wrapped as SVG. `/brand/logo.svg` is a public URL contract
// (Auth0 Universal Login renders it, and it serves as the scalable favicon), so
// the path and content type stay stable while the artwork inside is the new
// official mark. The icon is theme-neutral (no white), safe on any background.
const BRAND_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" role="img" aria-label="CostFlow"><image width="192" height="192" href="data:image/png;base64,${ICON_192.toString('base64')}"/></svg>`;

// Styled body for a CSRF mismatch (stale tab, expired session): explains what
// happened instead of a bare "Invalid CSRF token." line.
const csrfErrorBody = `<div class="empty" style="max-width:34rem;margin:2.5rem auto">
  <h3>That form has expired</h3>
  <p>The page was open for a while or your session changed, so the form couldn't be submitted
  safely. Nothing was saved. Go back, refresh, and try again.</p>
  <a class="btn" href="/">Back to CostFlow</a>
</div>`;

const PROVENANCE_LABEL: Record<Provenance, string> = {
  'vendor-suggested': 'vendor suggested, not used in pricing until you accept or customize it',
  'customer-accepted': 'accepted by you',
  'customer-customized': 'customized by you',
  'customer-measured': 'measured',
};

const DECIMAL = /^\d+(\.\d+)?$/;

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { store, connectors, auth, telemetry } = deps;
  const app = Fastify({ trustProxy: deps.trustProxy === true });
  void app.register(fastifyCookie);
  void app.register(fastifyFormbody);

  // In OIDC mode the Sign-out form's POST 302s to the IdP's logout endpoint (a
  // cross-origin URL). Allowlist that origin in CSP form-action or the browser
  // silently blocks the redirect ("Sign out does nothing" — prod-only, since
  // dev mode redirects to same-origin /logged-out).
  const formActionOrigins =
    auth.mode === 'oidc' && auth.oidc ? [new URL(auth.oidc.issuer).origin] : [];

  registerSecurity(app, {
    production: deps.production === true,
    store,
    formActionOrigins,
    ...(deps.logSink ? { logSink: deps.logSink } : {}),
  });

  // Injected sanitized structured log sink (tests capture it); stdout JSON by
  // default. Defined here so the auth routes can emit callback diagnostics.
  const logLine =
    deps.logSink ?? ((line: Record<string, unknown>) => console.log(JSON.stringify(line)));

  registerAuthRoutes(
    app,
    auth,
    store,
    (ok) => telemetry(webEvent('tm-web-signin', { ok })),
    logLine,
    (role) => telemetry(webEvent('tm-web-invite-accepted', { role })),
  );

  // Clear every auth-bearing cookie (session + in-flight OIDC state). Used by
  // both sign-out and organization erasure so the two paths cannot drift.
  const clearAuthCookies = (reply: FastifyReply): void => {
    clearSession(reply, auth.secureCookies === true);
    reply.clearCookie('cf_oidc_state', {
      path: '/',
      httpOnly: true,
      sameSite: auth.secureCookies === true ? 'none' : 'lax',
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
      return reply.code(403).type('text/html').send(layout('Session expired', csrfErrorBody));
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
          '<div class="panel" style="max-width:32rem;margin:2rem auto;text-align:center">' +
            "<h1>You're signed out</h1>" +
            '<p class="lead">Sign back in to pick up where you left off.</p>' +
            '<div class="hero-actions" style="margin-top:1.5rem"><a class="btn btn-lg" href="/login">Sign in</a></div>' +
            '</div>',
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
      void reply.code(403).type('text/html').send(layout('Session expired', csrfErrorBody));
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

  // Human-readable, timezone-stable timestamp for lists (deterministic — parsed
  // from the ISO string, never locale/TZ-dependent).
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const fmtWhen = (iso: string): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
    if (!m) return esc(iso);
    return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}, ${m[4]}:${m[5]} UTC`;
  };

  // Executive list row for a stored run: the headline is the expected total —
  // the number a reader scans for — with a safe fallback when the artifact
  // can't be summarized.
  const runRow = (r: { id: string; createdAt: string; runJson: string }): string => {
    const s = runSummary(r.runJson);
    const title =
      s === null
        ? 'Friction analysis'
        : s.priced === 0
          ? 'No priced frictions'
          : `${esc(s.expectedText)} expected`;
    const sub = `${fmtWhen(r.createdAt)}${s !== null && s.priced > 0 ? `, ${s.priced} priced` : ''}. Ref ${esc(r.id)}`;
    return `<li class="row"><a class="row-main" href="/reports/${esc(r.id)}"><span>${title}</span><span class="row-sub">${sub}</span></a><span class="row-go">View report →</span></li>`;
  };

  // Styled "not found" for a missing resource (job/run/member), replacing the
  // bare-text 404. Uses the public shell so it renders with or without chrome.
  const notFound = (reply: FastifyReply): FastifyReply =>
    reply
      .code(404)
      .type('text/html')
      .send(
        layout(
          'Not found',
          `<div class="empty" style="max-width:34rem;margin:2.5rem auto">
             <h3>We couldn't find that</h3>
             <p>The page or item you're looking for doesn't exist, was deleted, or isn't yours to view.</p>
             <a class="btn" href="/">Back to CostFlow</a>
           </div>`,
        ),
      );

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

  // Sanitized diagnostics for connector gateway failures (P4.2 defect 2): the
  // stage, error class, and HTTP status — never URLs, credentials, item
  // titles, actor names, or customer data.
  const gatewayFailure = (
    error: unknown,
  ): { errorClass: string; stage: string; status?: number } => {
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

  // Resolve a workspace's connector. Every stored provider id was validated at
  // /connect, so a miss means the registry shrank — surface it, don't guess.
  const connectorOf = (workspace: WorkspaceRecord): Connector => {
    const connector = connectors.get(workspace.provider);
    if (!connector) {
      throw new Error(`No connector is registered for provider "${workspace.provider}".`);
    }
    return connector;
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

  const credentialsOf = (workspace: WorkspaceRecord) => ({
    params: workspace.connectionParams,
    secret: decryptSecret(workspace.tokenCiphertext, auth.credentialKey),
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
      '<div class="info">This is a <strong>sample report</strong> built from demo data. ' +
      '<a href="/login">Sign in</a> to run one on your own Jira or ClickUp.</div>';
    let body: string;
    try {
      body = renderReportBody(parseRun(DEMO_RUN_JSON), { runId: 'demo' });
    } catch {
      body = '<p class="error">The sample report is temporarily unavailable.</p>';
    }
    const cta =
      '<div class="cta-band" style="margin-top:2.5rem">' +
      '<h2>Ready to see your own?</h2>' +
      '<p class="lead">Connect Jira or ClickUp and get a report like this for your own team in about a minute. Free while in beta.</p>' +
      '<div class="hero-actions"><a class="btn btn-lg" href="/login">Get started free</a></div>' +
      '</div>';
    return reply
      .type('text/html')
      .send(
        layout(
          'Sample report',
          `${banner}${body}${cta}<p style="margin-top:1.5rem"><a href="/">← Home</a></p>`,
        ),
      );
  });

  // ---------- Interactive Demo Mode (no signup, no Jira, no auth) ----------
  // "Try CostFlow" → an animated analysis of a RANDOM realistic company, run
  // through the real engine. Every visit generates a different company.

  app.get('/try', async (_request, reply) => {
    const seed = randomDemoSeed();
    return reply
      .type('text/html')
      .header('cache-control', 'no-store')
      .send(demoAnalyzingPage(seed));
  });

  app.get('/try/report', async (request, reply) => {
    const raw = (request.query as { seed?: string }).seed;
    // Seed is a bounded positive integer that only feeds a PRNG — no injection
    // surface. An invalid/absent seed just gets a fresh random company.
    const parsed = raw !== undefined && /^\d{1,10}$/.test(raw) ? Number(raw) : randomDemoSeed();
    const seed = parsed >= 1 && parsed <= 2_147_483_646 ? parsed : randomDemoSeed();
    let demo;
    try {
      demo = renderDemoCompany(seed);
    } catch {
      return reply
        .type('text/html')
        .send(
          layout(
            'Demo',
            '<div class="empty" style="max-width:34rem;margin:2.5rem auto"><h3>The demo hiccuped</h3><p>Please <a href="/try">try another company</a>.</p></div>',
          ),
        );
    }
    const banner = `<div class="info">You just analyzed <strong>${esc(demo.companyName)}</strong>, a simulated ${esc(demo.industry)} with ${demo.issueCount} issues and a ${demo.teamSize}-person team, generated fresh for this demo and run through the real CostFlow engine. <a href="/try">Generate a different company →</a></div>`;
    const cta =
      '<div class="cta-band" style="margin-top:2.5rem">' +
      '<h2>Now do it for your own team.</h2>' +
      '<p class="lead">Connect Jira or ClickUp in about a minute and get this report on your real board. Free and read-only.</p>' +
      '<div class="hero-actions"><a class="btn btn-lg lp-cta-btn" href="/signup">Get started free</a>' +
      '<a class="lp-cta-link" href="/try">or try another company →</a></div>' +
      '</div>';
    return reply
      .type('text/html')
      .header('cache-control', 'public, max-age=1800')
      .send(
        layout(
          `Demo: ${demo.companyName}`,
          `${banner}${demo.reportBody}${cta}<p style="margin-top:1.5rem"><a href="/">← Home</a></p>`,
          undefined,
          // Infinite seed space — canonicalise crawlers to /try, don't index each.
          { canonical: 'https://app.fbx1.com/try', noindex: true },
        ),
      );
  });

  // Public brand logo — served so Auth0 Universal Login can render the same
  // CostFlow mark the app header uses (one identity across product + sign-in).
  app.get('/brand/logo.svg', async (_request, reply) =>
    reply
      .type('image/svg+xml')
      .header('cache-control', 'public, max-age=86400')
      .send(BRAND_LOGO_SVG),
  );

  // The official logo set: standalone icon (favicon/manifest/compact nav) and
  // the full horizontal logo, one variant per theme (the wordmark is white on
  // dark, ink on light; the icon itself is theme-neutral).
  const brandPng: ReadonlyArray<readonly [string, Buffer]> = [
    ['/brand/icon-192.png', ICON_192],
    ['/brand/icon-512.png', ICON_512],
    ['/brand/logo-dark.png', LOGO_DARK],
    ['/brand/logo-light.png', LOGO_LIGHT],
  ];
  for (const [path, body] of brandPng) {
    app.get(path, async (_request, reply) =>
      reply.type('image/png').header('cache-control', 'public, max-age=86400').send(body),
    );
  }
  app.get('/favicon.ico', async (_request, reply) =>
    reply.type('image/x-icon').header('cache-control', 'public, max-age=86400').send(FAVICON_ICO),
  );
  app.get('/site.webmanifest', async (_request, reply) =>
    reply
      .type('application/manifest+json')
      .header('cache-control', 'public, max-age=86400')
      .send(WEB_MANIFEST),
  );

  // Social preview card (absolute HTTPS URL in og:image) + iOS icon. Served
  // from memory; crawlers (WhatsApp/X/LinkedIn/Slack/…) fetch these directly.
  app.get('/og.jpg', async (_request, reply) =>
    reply.type('image/jpeg').header('cache-control', 'public, max-age=86400').send(OG_IMAGE),
  );
  app.get('/apple-touch-icon.png', async (_request, reply) =>
    reply.type('image/png').header('cache-control', 'public, max-age=86400').send(APPLE_TOUCH_ICON),
  );

  // ---------- SEO: robots + sitemap (canonical host app.fbx1.com) ----------
  // Crawl the public marketing/demo surface; keep the app and per-seed demo
  // reports out of the index (auth-gated or infinite seed space).
  app.get('/robots.txt', async (_request, reply) =>
    reply
      .type('text/plain')
      .header('cache-control', 'public, max-age=86400')
      .send(
        `User-agent: *
Allow: /$
Allow: /demo
Allow: /try$
Allow: /terms
Allow: /privacy
Disallow: /try/report
Disallow: /dashboard
Disallow: /runs
Disallow: /reports
Disallow: /jobs
Disallow: /connect
Disallow: /scope
Disallow: /mapping
Disallow: /assumptions
Disallow: /org
Disallow: /settings
Disallow: /admin
Disallow: /auth
Disallow: /login
Disallow: /signup
Disallow: /invite

Sitemap: https://app.fbx1.com/sitemap.xml
`,
      ),
  );

  app.get('/sitemap.xml', async (_request, reply) => {
    const urls: [string, string][] = [
      ['/', '1.0'],
      ['/try', '0.9'],
      ['/demo', '0.8'],
      ['/privacy', '0.3'],
      ['/terms', '0.3'],
    ];
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls
        .map(
          ([loc, pri]) =>
            `  <url><loc>https://app.fbx1.com${loc}</loc><changefreq>weekly</changefreq><priority>${pri}</priority></url>`,
        )
        .join('\n') +
      `\n</urlset>\n`;
    return reply
      .type('application/xml')
      .header('cache-control', 'public, max-age=86400')
      .send(body);
  });

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
      return notFound(reply);
    }
    const stats = await store.funnelStats();
    const pct = (n: number, d: number): string =>
      d === 0 ? 'n/a' : `${Math.round((n / d) * 100)}%`;
    const row = (label: string, n: number): string =>
      `<tr><td>${label}</td><td>${n}</td><td>${pct(n, stats.organizations)}</td></tr>`;
    return reply.type('text/html').send(
      page(
        session,
        'Admin: activation funnel',
        `<p class="eyebrow">Admin</p>
         <h1 style="margin-top:.6rem">Activation funnel</h1>
         <div class="table-wrap" style="max-width:34rem"><table><tr><th>Stage</th><th>Organizations</th><th>of signups</th></tr>
           ${row('Signed up', stats.organizations)}
           ${row('Connected a workspace', stats.connectedWorkspaces)}
           ${row('Ran an analysis', stats.analysesRun)}
           ${row('Viewed a report', stats.reportsViewed)}
         </table></div>
         <p class="note">Aggregate counts of distinct organizations reaching each step. No customer content, emails, or identities.</p>`,
      ),
    );
  });

  app.get('/dashboard', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const workspace = await requireStep(session, reply, 'assumptions-set');
    if (!workspace) return;
    const connector = connectorOf(workspace);
    const runs = await store.listRuns(session.tenantId);
    const jobs = await store.listJobsForWorkspace(session.tenantId, workspace.id);
    const failed = jobs.filter((j) => j.status === 'failed').slice(-3);
    return reply.type('text/html').send(
      page(
        session,
        'Dashboard',
        renderDashboard({
          scopeName: workspace.scopeName,
          scopeId: workspace.scopeId,
          connectionText: connector.describeConnection(workspace.connectionParams),
          providerName: connector.descriptor.name,
          scopeNounSingular: connector.descriptor.scopeNoun.singular,
          csrfField: csrfField(session),
          runs,
          failures: failed,
        }),
      ),
    );
  });

  // ---------- step 1: connect (provider picker + descriptor-driven form) ----------

  const fieldInput = (
    field: ConnectFieldSpec,
    value: string | undefined,
    autofocus: boolean,
  ): string => {
    const type = field.kind === 'secret' ? 'password' : field.kind === 'email' ? 'email' : 'text';
    const extras = [
      field.kind === 'url' ? 'inputmode="url"' : '',
      field.autocomplete ? `autocomplete="${esc(field.autocomplete)}"` : '',
      field.kind === 'secret' ? 'autocomplete="off"' : '',
      autofocus ? 'autofocus' : '',
    ]
      .filter(Boolean)
      .join(' ');
    // Secrets are never echoed back into the form, even after a failed submit.
    const shown = field.kind === 'secret' ? '' : (value ?? '');
    return `<label>${esc(field.label)} <input name="${esc(field.name)}" type="${type}" placeholder="${esc(field.placeholder)}" required ${extras} value="${esc(shown)}"></label>`;
  };

  // Provider picker: shown when nothing is connected yet and no provider was
  // chosen. Every card leads to the same /connect form, parameterized.
  const pickerPage = (session: Session): string =>
    page(
      session,
      'Connect a tracker',
      `${stepsNav('connect')}
       <p class="eyebrow">Step 1: Connect</p>
       <h1 style="margin-top:.6rem">Where does your team track work?</h1>
       <p class="lead">CostFlow connects read-only, analyzes your workflow history, and prices the
       friction. Credentials are encrypted at rest and never shown again.</p>
       <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:1rem;max-width:44rem;margin-top:1.5rem">
         ${connectors
           .list()
           .map(
             (
               c,
             ) => `<a class="panel" style="display:block;text-decoration:none" href="/connect?provider=${esc(c.descriptor.id)}">
              <h3 style="margin:0 0 .35rem">${esc(c.descriptor.name)}</h3>
              <p class="note" style="margin:0">${esc(c.descriptor.pickerBlurb)}</p>
            </a>`,
           )
           .join('')}
       </div>`,
    );

  // One renderer for first visit AND failed submits: an error never strands the
  // user on a dead-end page — the form re-renders with their values preserved
  // (never the secret) and the reason on top.
  const connectPage = (
    session: Session,
    connector: Connector,
    opts: {
      values?: Readonly<Record<string, string>>;
      error?: string;
      connectedNote?: string;
      helpOpen?: boolean;
    },
  ): string => {
    const d = connector.descriptor;
    const switchNote =
      connectors.list().length > 1
        ? `<p class="note" style="margin-top:1rem">Not ${esc(d.name)}? <a href="/connect?picker=1">Choose a different tracker.</a></p>`
        : '';
    return page(
      session,
      `Connect ${d.name}`,
      `${stepsNav('connect')}
       <p class="eyebrow">Step 1: Connect</p>
       <h1 style="margin-top:.6rem">Connect your ${esc(d.connectionNoun)}</h1>
       <p class="lead">${esc(d.connectLead)}</p>
       <div class="panel" style="max-width:38rem;margin-top:1.5rem">
         ${opts.error ? `<div class="error" role="alert">${opts.error}</div>` : ''}
         ${opts.connectedNote ?? ''}
         <form method="post" action="/connect">${csrfField(session)}
           <input type="hidden" name="provider" value="${esc(d.id)}">
           ${d.fields
             .map((field, index) =>
               fieldInput(
                 field,
                 opts.values?.[field.name],
                 index === 0 && !opts.values?.[field.name],
               ),
             )
             .join('\n           ')}
           <button type="submit">Validate &amp; connect</button>
         </form>
         <details style="margin-top:1.25rem"${opts.helpOpen ? ' open' : ''}>
           ${d.helpHtml}
         </details>
         ${switchNote}
       </div>`,
    );
  };

  app.get('/connect', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const workspace = await soleWorkspace(session);
    const query = request.query as { provider?: string; picker?: string };
    const chosen = query.provider !== undefined ? connectors.get(query.provider) : null;
    // Explicit picker request, or nothing connected and nothing chosen yet.
    if (query.picker === '1' || (!workspace && !chosen)) {
      return reply.type('text/html').send(pickerPage(session));
    }
    const connector = chosen ?? connectorOf(workspace as WorkspaceRecord);
    const sameProvider = workspace && workspace.provider === connector.descriptor.id;
    return reply.type('text/html').send(
      connectPage(session, connector, {
        values: sameProvider ? workspace.connectionParams : {},
        connectedNote: sameProvider
          ? `<div class="info">Connected: ${esc(connector.describeConnection(workspace.connectionParams))}. Submitting replaces the stored credentials.</div>`
          : workspace
            ? `<div class="info">This workspace is currently connected to ${esc(connectorOf(workspace).descriptor.name)}. Connecting ${esc(connector.descriptor.name)} replaces that connection and restarts setup from scope selection; existing reports are kept.</div>`
            : '',
        helpOpen: !workspace,
      }),
    );
  });

  app.post('/connect', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const body = request.body as Record<string, unknown>;
    const providerId = String(body['provider'] ?? '');
    const connector = connectors.get(providerId);
    if (!connector) {
      telemetry(
        webEvent('tm-web-workspace-connected', {
          provider: 'unknown',
          ok: false,
          errorClass: 'cli-error',
        }),
      );
      return reply.redirect('/connect?picker=1');
    }
    const provider = connector.descriptor.id;
    const parsed = connector.parseConnectForm(body);
    const echoedValues = (): Record<string, string> => {
      const values: Record<string, string> = {};
      for (const field of connector.descriptor.fields) {
        if (field.kind !== 'secret') values[field.name] = String(body[field.name] ?? '').trim();
      }
      return values;
    };
    if (!parsed.ok) {
      telemetry(
        webEvent('tm-web-workspace-connected', { provider, ok: false, errorClass: 'cli-error' }),
      );
      return reply
        .code(400)
        .type('text/html')
        .send(connectPage(session, connector, { values: echoedValues(), error: parsed.error }));
    }
    try {
      await connector.gateway.listScopes({ params: parsed.params, secret: parsed.secret });
    } catch (error) {
      const errorClass = error instanceof GatewayError ? error.errorClass : 'unexpected';
      telemetry(webEvent('tm-web-workspace-connected', { provider, ok: false, errorClass }));
      // Shape only (class + optional HTTP status) — the raw gateway message is
      // never echoed, matching the /scope import-error policy.
      const status = error instanceof GatewayError && error.status ? `, HTTP ${error.status}` : '';
      return reply
        .code(400)
        .type('text/html')
        .send(
          connectPage(session, connector, {
            values: echoedValues(),
            error: `We couldn't validate this connection (${esc(errorClass)}${status}). Check every field and that the token was copied completely, then try again.`,
          }),
        );
    }
    const tokenCiphertext = encryptSecret(parsed.secret, auth.credentialKey);
    const existing = await soleWorkspace(session);
    if (existing && existing.provider === provider) {
      // Same platform: refresh credentials, keep scope/mapping/assumptions.
      await store.updateWorkspace(session.tenantId, existing.id, {
        connectionParams: parsed.params,
        tokenCiphertext,
      });
    } else if (existing) {
      // Platform switch: new connection, so scope and vocabulary start over.
      // Existing runs are append-only history and are kept.
      await store.updateWorkspace(session.tenantId, existing.id, {
        provider,
        connectionParams: parsed.params,
        tokenCiphertext,
        scopeId: null,
        scopeName: null,
        observedStatuses: [],
        observedActors: [],
        statusHints: null,
        statusMap: null,
        actorRoleMap: null,
        onboarding: 'connected',
      });
    } else {
      await store.createWorkspace(session.tenantId, {
        provider,
        connectionParams: parsed.params,
        tokenCiphertext,
      });
    }
    telemetry(webEvent('tm-web-workspace-connected', { provider, ok: true, errorClass: null }));
    return reply.redirect('/scope');
  });

  // ---------- step 2: scope selection ----------

  app.get('/scope', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const workspace = await requireStep(session, reply, 'connected');
    if (!workspace) return;
    const connector = connectorOf(workspace);
    const d = connector.descriptor;
    let scopes;
    try {
      scopes = await connector.gateway.listScopes(credentialsOf(workspace));
    } catch (error) {
      const f = gatewayFailure(error);
      logLine({ level: 'warn', msg: 'connector-list-scopes-failed', provider: d.id, ...f });
      return reply.type('text/html').send(page(session, 'Choose scope', importErrorHtml(f)));
    }
    return reply.type('text/html').send(
      page(
        session,
        'Choose scope',
        `${stepsNav('scope')}
         <p class="eyebrow">Step 2: Scope</p>
         <h1 style="margin-top:.6rem">Choose the ${esc(d.scopeNoun.singular)} to import</h1>
         <p class="lead">Pick the ${esc(d.name)} ${esc(d.scopeNoun.singular)} you want CostFlow to analyze. You can reconnect and switch it later.</p>
         ${
           scopes.length === 0
             ? `<div class="empty" style="max-width:38rem">
                  <h3>No ${esc(d.scopeNoun.plural)} found</h3>
                  <p>This account can't see any ${esc(d.name)} ${esc(d.scopeNoun.plural)}. Check that the API token belongs to a user with access, then reconnect.</p>
                  <a class="btn" href="/connect">Back to connection</a>
                </div>`
             : `<form method="post" action="/scope" class="panel" style="max-width:40rem;margin-top:1.5rem">${csrfField(session)}
                 ${scopes
                   .map(
                     (s, index) =>
                       `<label class="pick"><input type="radio" name="scope" value="${index}" ${
                         workspace.scopeId === s.id || (!workspace.scopeId && scopes.length === 1)
                           ? 'checked'
                           : ''
                       } required><span><span style="flex:1">${esc(s.name)} (${esc(s.id)})</span></span></label>`,
                   )
                   .join('')}
                 <button type="submit" style="margin-top:.5rem">Import this ${esc(d.scopeNoun.singular)}</button>
               </form>`
         }`,
      ),
    );
  });

  app.post('/scope', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const workspace = await requireStep(session, reply, 'connected');
    if (!workspace) return;
    const connector = connectorOf(workspace);
    const d = connector.descriptor;
    const credentials = credentialsOf(workspace);
    let scopes;
    try {
      scopes = await connector.gateway.listScopes(credentials);
    } catch (error) {
      const f = gatewayFailure(error);
      logLine({ level: 'warn', msg: 'connector-list-scopes-failed', provider: d.id, ...f });
      return reply
        .code(400)
        .type('text/html')
        .send(page(session, 'Choose scope', importErrorHtml(f)));
    }
    const body = request.body as { scope?: string; project?: string };
    // "project" is the pre-ADR-0005 field name; accepted so an in-flight form
    // submitted across a deploy still lands.
    const index = Number(body.scope ?? body.project);
    const scope = scopes[index];
    if (!scope) {
      return reply
        .code(400)
        .type('text/html')
        .send(
          page(
            session,
            'Choose scope',
            `<div class="error" role="alert">That selection is no longer valid. The ${esc(d.scopeNoun.singular)} list may have changed.</div>
             <p><a class="btn btn-ghost" href="/scope">Back to selection</a></p>`,
          ),
        );
    }
    const maxIssues = deps.maxIssues ?? 50_000;
    let observed;
    try {
      const raw = await connector.gateway.fetchAll(credentials, scope.id);
      observed = connector.observe(raw);
      // Reliability guard: count before the memory-heavy analysis.
      if (observed.itemCount > maxIssues) {
        logLine({
          level: 'warn',
          msg: 'import-too-large',
          provider: d.id,
          itemCount: observed.itemCount,
          maxIssues,
        });
        return reply
          .code(400)
          .type('text/html')
          .send(
            page(
              session,
              'Choose scope',
              `<div class="error" role="alert">This ${esc(d.scopeNoun.singular)} has <strong>${observed.itemCount.toLocaleString('en-US')}</strong> ${esc(d.itemNoun)}, which is above the current per-${esc(d.scopeNoun.singular)} limit of <strong>${maxIssues.toLocaleString('en-US')}</strong>. Narrow the scope and reconnect, or email <a href="mailto:support@fbx1.com">support@fbx1.com</a> to enable a larger import.</div>
               <p><a class="btn btn-ghost" href="/scope">Back to selection</a></p>`,
            ),
          );
      }
    } catch (error) {
      const f = gatewayFailure(error);
      logLine({ level: 'warn', msg: 'import-failed', provider: d.id, ...f });
      return reply
        .code(400)
        .type('text/html')
        .send(page(session, 'Choose scope', importErrorHtml(f)));
    }
    await store.updateWorkspace(session.tenantId, workspace.id, {
      scopeId: scope.id,
      scopeName: scope.name,
      observedStatuses: observed.statuses,
      observedActors: observed.actors,
      statusHints: observed.statusHints,
      onboarding:
        onboardingRank(workspace.onboarding) > onboardingRank('scope-selected')
          ? workspace.onboarding
          : 'scope-selected',
    });
    telemetry(webEvent('tm-web-scope-selected', { provider: d.id }));
    return reply.redirect('/mapping/statuses');
  });

  // ---------- step 3: status mapping ----------

  app.get('/mapping/statuses', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const workspace = await requireStep(session, reply, 'scope-selected');
    if (!workspace) return;
    const providerName = connectorOf(workspace).descriptor.name;
    return reply.type('text/html').send(
      page(
        session,
        'Map statuses',
        `${stepsNav('statuses')}
         <p class="eyebrow">Step 3: Statuses</p>
         <h1 style="margin-top:.6rem">Map every status to a stage kind</h1>
         <p class="lead">All ${workspace.observedStatuses.length} observed statuses, current and historical, must be mapped. The analysis refuses to run if history passes through an unmapped status.</p>
         <form method="post" action="/mapping/statuses" class="panel" style="margin-top:1.5rem">${csrfField(session)}
           <div class="info">We've pre-selected suggestions from the ${esc(providerName)} workflow. Review each one, adjust anything that's off, and save.</div>
           <div class="table-wrap"><table><tr><th>Status in ${esc(providerName)}</th><th>Stage kind</th></tr>
           ${workspace.observedStatuses
             .map((status, index) => {
               // Saved mapping wins; then the connector's hint (captured at
               // scope time from provider metadata or name heuristics). Form
               // defaults only — the user approves every row (invariant 6).
               const chosen =
                 workspace.statusMap?.[status] ?? workspace.statusHints?.[status] ?? null;
               return `<tr><td>${esc(status)}</td><td><select name="s${index}" required>
                    <option value="" ${chosen === null ? 'selected' : ''} disabled>Choose</option>
                    ${STAGE_KINDS.map(
                      (k) => `<option value="${k}" ${chosen === k ? 'selected' : ''}>${k}</option>`,
                    ).join('')}
                  </select></td></tr>`;
             })
             .join('')}
           </table></div>
           <button type="submit" style="margin-top:1.1rem">Save status mapping</button>
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
          .type('text/html')
          .send(
            page(
              session,
              'Map statuses',
              `<div class="error" role="alert">Every status needs a stage kind. One selection is missing.</div>
               <p><a class="btn btn-ghost" href="/mapping/statuses">Back to status mapping</a></p>`,
            ),
          );
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
         <p class="eyebrow">Step 4: Roles</p>
         <h1 style="margin-top:.6rem">Map people to roles</h1>
         <p class="lead">Roles like "Legal" or "Ops" decide which hourly rate prices the work. Anyone left
         blank is pseudonymized and priced at the default rate with reduced confidence.</p>
         <form method="post" action="/mapping/actors" class="panel" style="margin-top:1.5rem">${csrfField(session)}
           <div class="info">This step is optional. Leaving everything blank is fine and is the fastest path to your first report. You can refine roles later.</div>
           <div class="table-wrap"><table><tr><th>Person (from ${esc(connectorOf(workspace).descriptor.name)})</th><th>Role (blank = pseudonymize)</th></tr>
           ${workspace.observedActors
             .map(
               (actor, index) =>
                 `<tr><td>${esc(actor)}</td><td><input name="a${index}" placeholder="e.g. Legal" value="${esc(
                   workspace.actorRoleMap?.[actor] ?? '',
                 )}"></td></tr>`,
             )
             .join('')}
           </table></div>
           <button type="submit" style="margin-top:1.1rem">Continue</button>
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

  // Client-side guard: the browser rejects malformed numbers before submit, so
  // nobody loses their edits to the server-side backstop.
  const decimalAttrs =
    'inputmode="decimal" pattern="\\d+(\\.\\d+)?" title="Non-negative decimal, e.g. 0.5"';
  const rangeInputs = (name: string, range: RangeSpec): string =>
    `<input name="${name}_low" size="6" ${decimalAttrs} value="${esc(range.low)}"> /
     <input name="${name}_expected" size="6" ${decimalAttrs} value="${esc(range.expected)}"> /
     <input name="${name}_high" size="6" ${decimalAttrs} value="${esc(range.high)}"> h/day`;

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
         <p class="eyebrow">Step 5: Assumptions</p>
         <h1 style="margin-top:.6rem">Confirm your assumptions</h1>
         <p class="lead">Nothing is priced on a vendor suggestion. Accept each value or set your own.
         Anything left unconfirmed stays unpriced in your reports. Currency: ${esc(current.currency)}.</p>
         <form method="post" action="/assumptions" class="panel" style="margin-top:1.5rem">${csrfField(session)}
           <div class="info"><label style="margin:0"><input type="checkbox" name="accept_all"> <strong>Accept all suggested values</strong>, the fastest path to a fully priced report. You can change any value now or refine later.</label></div>
           <div class="table-wrap"><table><tr><th>Assumption</th><th>Value</th><th>Status</th></tr>
           ${current.rates
             .map((rate, index) =>
               row(
                 `Hourly rate for ${rate.roleRef}`,
                 rate.provenance,
                 `<input name="rate${index}" size="8" ${decimalAttrs} value="${esc(rate.hourlyRate)}"> ${esc(current.currency)}/h`,
                 `rate${index}`,
               ),
             )
             .join('')}
           ${row(
             'Default hourly rate (unmapped people, roles without a rate)',
             current.defaultRate.provenance,
             `<input name="defaultRate" size="8" ${decimalAttrs} value="${esc(current.defaultRate.hourlyRate)}"> ${esc(current.currency)}/h`,
             'defaultRate',
           )}
           ${row(
             'Aging threshold (days untouched before an item counts as aging)',
             current.parameters.agingThresholdDays.provenance,
             `<input name="agingThresholdDays" size="4" inputmode="numeric" pattern="\\d+" title="Whole number of days" value="${current.parameters.agingThresholdDays.value}"> days`,
             'agingThresholdDays',
           )}
           ${row(
             'Attention on aging items (hours per day: low, expected, high)',
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
           </table></div>
           <button type="submit" style="margin-top:1.1rem">Save assumptions</button>
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
            `<p class="error">Invalid value(s) for: ${esc(invalid.join(', '))}. Use non-negative decimals only.</p>
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
    // Double-submit guard: a second click (or a refresh re-POST) while a job
    // is queued/running lands on the SAME job instead of starting a duplicate
    // fetch + analysis against the customer's tracker.
    const active = (await store.listJobsForWorkspace(session.tenantId, workspace.id)).find(
      (j) => j.status === 'queued' || j.status === 'running',
    );
    if (active) return reply.redirect(`/jobs/${active.id}`);
    const job = await store.createJob(session.tenantId, workspace.id);
    const startedMs = Date.now();
    const execution = executeJob(
      {
        store,
        connectors,
        credentialKey: auth.credentialKey,
        ...(deps.jobNowFn ? { nowFn: deps.jobNowFn } : {}),
      },
      session.tenantId,
      job.id,
    ).then(async () => {
      const finished = await store.getJob(session.tenantId, job.id);
      telemetry(
        webEvent('tm-web-run', {
          provider: workspace.provider,
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
    if (!job) return notFound(reply);
    if (job.status === 'succeeded' && job.runId) {
      return reply.redirect(`/reports/${job.runId}`);
    }
    if (job.status === 'failed') {
      return reply.type('text/html').send(
        page(
          session,
          'Run failed',
          `<div class="panel" style="max-width:38rem">
             <h1>The analysis didn't finish</h1>
             <p class="lead">We hit a problem while importing or analyzing your project. Nothing was saved from this run.</p>
             <div class="error"><strong>${esc(job.errorClass ?? 'unexpected')}</strong>${job.errorMessage ? `: ${esc(job.errorMessage)}` : ''}</div>
             <div class="hero-actions" style="justify-content:flex-start;margin-top:1.25rem">
               <form method="post" action="/runs">${csrfField(session)}<button type="submit">Run again</button></form>
               <a class="btn btn-ghost" href="/connect">Check connection</a>
             </div>
           </div>`,
        ),
      );
    }
    return reply.type('text/html').send(loadingPage());
  });

  app.get('/runs', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const user = await currentUser(session);
    const allowed = await accessibleWorkspaceIds(session, user);
    let runs = await store.listRuns(session.tenantId);
    if (allowed) runs = runs.filter((r) => allowed.has(r.workspaceId));
    return reply.type('text/html').send(
      page(
        session,
        'Runs',
        runs.length === 0
          ? `<h1>Reports</h1>
               <div class="empty">
                 <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 10 12 14 15 20 8"/><circle cx="10" cy="12" r="1.4"/><circle cx="14" cy="15" r="1.4"/></svg></span>
                 <h3>No reports yet</h3>
                 <p>Run your first analysis to see what friction is costing your team.</p>
                 <a class="btn" href="/">Start an analysis</a>
               </div>`
          : `<h1>Reports</h1>
               <p class="note">${runs.length} ${runs.length === 1 ? 'report' : 'reports'}, newest first.</p>
               <ul class="rows">${runs.map((r) => runRow(r)).join('')}</ul>`,
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
      void notFound(reply);
      return null;
    }
    const viewer = await currentUser(session);
    const allowed = await accessibleWorkspaceIds(session, viewer);
    if (allowed && !allowed.has(record.workspaceId)) {
      void notFound(reply);
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
             <h3>${esc(w.scopeName ?? 'Unconfigured workspace')} (${esc(w.scopeId ?? w.provider)})</h3>
             <p class="note">${esc(connectors.get(w.provider)?.describeConnection(w.connectionParams) ?? w.provider)}. Deleting removes this workspace and every run and job derived from it. This cannot be undone.</p>
             <form method="post" action="/workspaces/${esc(w.id)}/delete">${csrfField(session)}
               <label>Type <strong>${DELETE_WORKSPACE_PHRASE}</strong> to confirm <input name="confirm" autocomplete="off" required></label>
               <button type="submit">Delete this workspace's data</button>
             </form>
           </div>`,
      )
      .join('');
    // Configuration hub: every workspace-setup surface lives here (not on the
    // executive dashboard). Summaries are provider-correct via the descriptor.
    const cfg = workspaces[0] ?? null;
    const cfgConnector = cfg ? connectors.get(cfg.provider) : undefined;
    const configCard = (title: string, summary: string, href: string, cta: string): string =>
      `<div class="card"><h3 style="margin-bottom:.3rem">${title}</h3><p class="note" style="margin:0 0 .7rem">${summary}</p><a href="${href}">${cta} →</a></div>`;
    const configCards = cfg
      ? `<h2 style="margin-top:.4rem">Workspace configuration</h2>
         <div class="grid grid-3" style="margin:0 0 2.2rem">
           ${configCard('Connection', esc(cfgConnector?.describeConnection(cfg.connectionParams) ?? cfg.provider), '/connect', 'Manage')}
           ${configCard('Scope', cfg.scopeName ? `${esc(cfg.scopeName)}${cfg.scopeId ? ` (${esc(cfg.scopeId)})` : ''}` : 'Not selected yet', '/scope', 'Change')}
           ${configCard('Statuses', cfg.statusMap ? `${Object.keys(cfg.statusMap).length} statuses mapped to stages` : 'Not mapped yet', '/mapping/statuses', 'Review')}
           ${configCard('Roles', cfg.actorRoleMap ? `${Object.keys(cfg.actorRoleMap).length} people mapped to roles` : 'Not mapped yet', '/mapping/actors', 'Review')}
           ${configCard('Assumptions', cfg.assumptions ? `Currency ${esc(cfg.assumptions.currency)}, version ${esc(cfg.assumptions.version)}` : 'Not set yet', '/assumptions', 'Review')}
           ${configCard('Organization &amp; members', 'Invitations, roles, and access', '/org', 'Manage')}
         </div>`
      : '';
    return reply.type('text/html').send(
      page(
        session,
        'Settings',
        `<p class="eyebrow">Settings</p>
         <h1 style="margin-top:.6rem">Settings</h1>
         ${configCards}
         <h2>Data &amp; privacy</h2>
         <p class="lead">You control your data. Deleting is permanent and cascades to every
         derived analysis (GDPR erasure). CostFlow keeps no copy.</p>
         ${
           (request.query as { done?: string }).done === 'workspace'
             ? '<div class="info" role="status">Workspace data permanently deleted, including every derived run and report.</div>'
             : ''
         }
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
            `<p class="error">Deletion not confirmed, so nothing was deleted. Type ${DELETE_WORKSPACE_PHRASE} exactly. <a href="/settings">Back</a></p>`,
          ),
        );
    }
    const summary = await store.deleteWorkspace(session.tenantId, workspaceId);
    if (!summary) return notFound(reply);
    telemetry(webEvent('tm-web-data-deleted', { scope: 'workspace', cascadedRuns: summary.runs }));
    return reply.redirect('/settings?done=workspace');
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
            `<p class="error">Deletion not confirmed, so nothing was deleted. Type ${esc(DELETE_ACCOUNT_PHRASE)} exactly. <a href="/settings">Back</a></p>`,
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
      return reply.type('text/html').send(
        layout(
          'Invitation',
          `<div class="panel" style="max-width:34rem;margin:2rem auto;text-align:center">
               <h1>Invitation unavailable</h1>
               <p class="lead">This invitation link is invalid, already used, or was revoked.</p>
               <div class="hero-actions" style="margin-top:1.25rem"><a class="btn btn-lg" href="/login">Sign in</a></div>
             </div>`,
        ),
      );
    }
    const tenant = await store.getTenant(invitation.tenantId);
    // Must survive the cross-site IdP round-trip (same reason as cf_oidc_state).
    reply.setCookie(INVITE_COOKIE, signValue({ token }, auth.sessionKey), {
      path: '/',
      httpOnly: true,
      sameSite: auth.secureCookies === true ? 'none' : 'lax',
      secure: auth.secureCookies === true,
    });
    return reply.type('text/html').send(
      layout(
        'Invitation',
        `<div class="panel" style="max-width:36rem;margin:2rem auto;text-align:center">
           <p class="eyebrow" style="margin:0 auto">You're invited</p>
           <h1 style="margin-top:1rem">Join ${esc(orgLabel(tenant?.name ?? null))}</h1>
           <p class="lead">You've been invited to join as <strong>${esc(invitation.role)}</strong>. Sign in as
           <strong>${esc(invitation.email)}</strong> to accept.</p>
           <div class="hero-actions" style="margin-top:1.5rem"><a class="btn btn-lg" href="/login">Continue to sign in</a></div>
         </div>`,
      ),
    );
  });

  // Post-action confirmations (no-JS success states): redirects land back here
  // with ?done=<key>; only keys from this fixed map ever render.
  const ORG_DONE: Record<string, string> = {
    renamed: 'Organization name saved.',
    invited: 'Invitation created. Share the invite link from the table below.',
    revoked: 'Invitation revoked.',
    role: 'Member role updated.',
    removed: 'Member removed from the organization.',
    granted: 'Workspace access granted.',
    ungranted: 'Workspace access removed.',
  };

  app.get('/org', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const doneKey = (request.query as { done?: string }).done;
    const doneBanner =
      doneKey && ORG_DONE[doneKey]
        ? `<div class="info" role="status">${ORG_DONE[doneKey]}</div>`
        : '';
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
            ? '<p class="note" style="margin:.4rem 0 .8rem">No explicit members. Owners and admins always have access.</p>'
            : memberIds
                .map((uid) => {
                  const mu = userById.get(uid);
                  return `<div style="display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid var(--line-2)">
                    <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(mu?.email ?? uid)}</span>
                    <form method="post" action="/workspaces/${esc(w.id)}/members/${esc(uid)}/remove" class="inline">${csrfField(session)}<button type="submit">Remove</button></form>
                  </div>`;
                })
                .join('');
        const addable = users.filter((u) => !memberIds.includes(u.id));
        const addForm =
          addable.length === 0
            ? ''
            : `<form method="post" action="/workspaces/${esc(w.id)}/members" class="inline" style="margin-top:.9rem">${csrfField(session)}
                 <select name="userId">${addable.map((u) => `<option value="${esc(u.id)}">${esc(u.email)}</option>`).join('')}</select>
                 <button type="submit">Grant access</button></form>`;
        return `<div class="ws"><h4>${esc(w.scopeName ?? 'Unconfigured workspace')} (${esc(w.scopeId ?? w.provider)})</h4>${memberList}${addForm}</div>`;
      })
      .join('');

    return reply.type('text/html').send(
      page(
        session,
        'Organization',
        `<p class="eyebrow">Organization</p>
         <h1 style="margin-top:.6rem">Organization &amp; members</h1>
         <p class="lead">Signed in as <strong>${esc(actor?.email ?? '')}</strong> (${esc(actor?.role ?? '')}).</p>
         ${doneBanner}

         <div class="panel">
           <h3 style="margin-top:0">Name</h3>
           <form method="post" action="/org/rename">${csrfField(session)}
             <label>Organization name <input name="name" value="${esc(orgLabel(tenant?.name ?? null))}" maxlength="100" required></label>
             <button type="submit">Save name</button>
           </form>
         </div>

         <div class="panel">
           <h3 style="margin-top:0">Members</h3>
           <div class="table-wrap"><table><tr><th>Email</th><th>Role</th><th></th></tr>${users.map(memberRow).join('')}</table></div>
         </div>

         <div class="panel">
           <h3 style="margin-top:0">Invitations</h3>
           ${
             invitations.length === 0
               ? '<p class="note">No invitations yet.</p>'
               : `<div class="table-wrap"><table><tr><th>Email</th><th>Role</th><th>Status</th><th>Invite link</th><th></th></tr>${invitations.map(invRow).join('')}</table></div>`
           }
           <form method="post" action="/org/invitations" style="margin-top:1.25rem">${csrfField(session)}
             <label>Invite email <input name="email" type="email" required autocomplete="off"></label>
             <label>Role <select name="role"><option value="member">member</option><option value="admin">admin</option></select></label>
             <button type="submit">Create invitation</button>
             <p class="note" style="margin-top:.75rem">Share the generated link with the invitee. They join this organization when they sign in with that email.</p>
           </form>
         </div>

         <div class="panel">
           <h3 style="margin-top:0">Workspace access</h3>
           <p class="note">Owners and admins can reach every workspace. Members reach only the workspaces granted here.</p>
           ${workspaces.length === 0 ? '<p class="note">No workspaces yet.</p>' : wsSection}
         </div>

         <div style="display:flex;gap:.5rem;margin-top:1.5rem"><a class="chip" href="/dashboard">Dashboard</a> <a class="chip" href="/settings">Settings</a></div>`,
      ),
    );
  });

  app.post('/org/rename', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const name = ((request.body as { name?: string }).name ?? '').trim();
    if (name === '' || name.length > 100) {
      return orgBadRequest(
        session,
        reply,
        'Organization name must be between 1 and 100 characters.',
      );
    }
    await store.updateTenantName(session.tenantId, name);
    telemetry(webEvent('tm-web-org-renamed', {}));
    return reply.redirect('/org?done=renamed');
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
    return reply.redirect('/org?done=invited');
  });

  app.post('/org/invitations/:id/revoke', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const id = (request.params as { id: string }).id;
    const updated = await store.updateInvitationStatus(session.tenantId, id, 'revoked', null);
    if (!updated) return notFound(reply);
    telemetry(webEvent('tm-web-invite-revoked', {}));
    return reply.redirect('/org?done=revoked');
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
    if (!target) return notFound(reply);
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
    return reply.redirect('/org?done=role');
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
    if (!target) return notFound(reply);
    if (actor?.role !== 'owner' && target.role === 'owner') {
      return forbidden(session, reply, 'Only the owner can remove an owner.');
    }
    if (target.role === 'owner' && (await countOwners(session.tenantId)) <= 1) {
      return orgBadRequest(session, reply, 'The organization must always have at least one owner.');
    }
    await store.removeUser(session.tenantId, targetId);
    telemetry(webEvent('tm-web-member-removed', {}));
    return reply.redirect('/org?done=removed');
  });

  app.post('/workspaces/:workspaceId/members', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const userId = (request.body as { userId?: string }).userId ?? '';
    const workspace = await store.getWorkspace(session.tenantId, workspaceId);
    if (!workspace) return notFound(reply);
    const member = await store.getUser(session.tenantId, userId);
    if (!member) return orgBadRequest(session, reply, 'Unknown member.');
    await store.addWorkspaceMember(session.tenantId, workspaceId, userId);
    telemetry(webEvent('tm-web-workspace-member-added', {}));
    return reply.redirect('/org?done=granted');
  });

  app.post('/workspaces/:workspaceId/members/:userId/remove', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const { workspaceId, userId } = request.params as { workspaceId: string; userId: string };
    const workspace = await store.getWorkspace(session.tenantId, workspaceId);
    if (!workspace) return notFound(reply);
    await store.removeWorkspaceMember(session.tenantId, workspaceId, userId);
    telemetry(webEvent('tm-web-workspace-member-removed', {}));
    return reply.redirect('/org?done=ungranted');
  });

  return app;
}
