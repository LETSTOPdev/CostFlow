import type { FastifyInstance } from 'fastify';
import { layout } from './html';
import { SAME_ORIGIN, ownerOf, type Site } from './site';
import type { Store } from './store/contract';

/**
 * Production security hardening (doc 09 P4.2 §2/§4/§5). Headers, health/
 * readiness probes, and a sanitized request log — all portable, no platform
 * lock-in. The CSP is deliberately strict: no scripts at all (the app ships
 * zero client JS), styles limited to the single inline stylesheet in the
 * layout, forms only to self, never framed.
 */

export interface SecurityContext {
  readonly production: boolean;
  readonly store: Store;
  /**
   * Extra origins to allow in the CSP `form-action` directive, beyond 'self'.
   * In OIDC mode this carries the IdP origin so the Sign-out form's redirect to
   * the RP-initiated-logout endpoint is not blocked. Empty in dev mode.
   */
  readonly formActionOrigins?: readonly string[];
  /** The two-host model. Defaults to one origin serving everything. */
  readonly site?: Site;
  /** Structured log sink; defaults to stdout JSON. Injected for tests. */
  readonly logSink?: (line: Record<string, unknown>) => void;
}

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/**
 * Sanitize a URL path for logging. Two rules:
 *  - the invitation capability token rides in the PATH (`/invite/<token>`);
 *    it is a secret and must never be logged — collapse to `/invite/:token`;
 *  - internal UUID ids (users, workspaces, invitations) collapse to `:id` so
 *    logs carry route shapes, not identifiers.
 */
export function redactPath(path: string): string {
  return path.replace(/^\/invite\/[^/]+/, '/invite/:token').replace(UUID_RE, ':id');
}

export function securityHeaders(
  production: boolean,
  formActionOrigins: readonly string[] = [],
): Record<string, string> {
  // The Sign-out button is a no-JS `<form method="post" action="/logout">`. In
  // OIDC mode the server answers with a 302 to the IdP's RP-initiated-logout
  // endpoint (a cross-origin URL), which then bounces back to /logged-out.
  // Browsers evaluate EVERY hop of a form-initiated navigation against
  // form-action, so the IdP origin must be allowlisted here or the redirect is
  // silently blocked ("Sign out does nothing"). 'self' still covers /logout and
  // the /logged-out landing; extra origins (the IdP) are added only in OIDC mode.
  const formAction = ["'self'", ...formActionOrigins].join(' ');
  const headers: Record<string, string> = {
    'Content-Security-Policy': [
      "default-src 'none'",
      "base-uri 'none'",
      `form-action ${formAction}`,
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "manifest-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'none'",
      "connect-src 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  };
  // HSTS only means anything over TLS — production terminates TLS at the edge.
  if (production) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

/**
 * Route a request to the host that owns its path.
 *
 * Marketing paths belong to `fbx1.com`, application paths to `app.fbx1.com`,
 * and each host 301s away only the paths it does NOT own. That asymmetry is
 * what makes a loop impossible: a redirect always moves a request to the host
 * that will serve it, and that host has no rule that would send it back.
 *
 * Three exceptions, all deliberate:
 *  - `/` exists on both (the landing on one, the sign-in screen on the other)
 *    and is never redirected;
 *  - shared assets and health probes answer identically on both, so redirecting
 *    them would break the identity provider's login-page logo and the
 *    platform's health checks, which arrive without a recognisable Host;
 *  - an unrecognised Host (the platform's internal `*.railway.app` name, a
 *    probe by IP) is served as-is rather than redirected somewhere it may not
 *    be able to follow.
 *
 * `www` folds into the apex first, so there is one canonical marketing origin
 * rather than two competing for the same search index entry.
 *
 * Entirely inert until the split is configured, which is what lets the code
 * ship ahead of the DNS change and roll back by unsetting one variable.
 */
export function registerHostRouter(app: FastifyInstance, site: Site): void {
  if (!site.split) return;
  // `hostname`, not `host`: the Host header is compared with its port stripped,
  // and a URL's `host` keeps one. Comparing the two forms means the router
  // silently never fires on any origin that names a port.
  const marketingHost = new URL(site.marketingOrigin).hostname.toLowerCase();
  const appHost = new URL(site.appOrigin).hostname.toLowerCase();

  app.addHook('onRequest', async (request, reply) => {
    const host = (request.headers.host ?? '').toLowerCase().split(':')[0] ?? '';
    if (host === `www.${marketingHost}`) {
      return reply.code(301).redirect(`${site.marketingOrigin}${request.url}`);
    }
    const owner = ownerOf(request.url);
    if (owner === 'root' || owner === 'shared') return;
    if (host === marketingHost && owner === 'app') {
      return reply.code(301).redirect(`${site.appOrigin}${request.url}`);
    }
    if (host === appHost && owner === 'marketing') {
      return reply.code(301).redirect(`${site.marketingOrigin}${request.url}`);
    }
  });
}

export function registerSecurity(app: FastifyInstance, context: SecurityContext): void {
  const log = context.logSink ?? ((line) => console.log(JSON.stringify(line)));
  const headers = securityHeaders(context.production, context.formActionOrigins ?? []);

  registerHostRouter(app, context.site ?? SAME_ORIGIN);

  app.addHook('onSend', async (request, reply, payload) => {
    for (const [name, value] of Object.entries(headers)) {
      reply.header(name, value);
    }
    // Authenticated responses may contain a customer's financial data (reports,
    // dashboards). Forbid all caching so a shared/public browser cannot reveal
    // them via the back button after sign-out. Public marketing pages (no
    // session cookie) stay cacheable. Health probes set their own no-store.
    if (request.cookies?.['cf_session'] && !reply.getHeader('cache-control')) {
      reply.header('cache-control', 'no-store, private');
    }
    return payload;
  });

  // Sanitized operational logging (plan §5): method, path (query stripped and
  // the path itself redacted — invite tokens live in the path, ids collapsed),
  // status, duration. NEVER bodies, headers, tokens, emails, or customer
  // vocabulary.
  app.addHook('onResponse', async (request, reply) => {
    log({
      level: 'info',
      msg: 'request',
      method: request.method,
      path: redactPath(request.url.split('?')[0] ?? request.url),
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    });
  });

  // Global error boundary: any uncaught error in a handler or hook returns a
  // GENERIC response — never the error message, which could carry a DB detail,
  // a decrypt failure, or other internals. The error name (a class, not a
  // value) is logged server-side for diagnosis; the redacted path locates it.
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const raw = typeof error.statusCode === 'number' ? error.statusCode : 500;
    const status = raw >= 400 && raw < 500 ? raw : 500;
    // Log the error NAME only (a class, not a value). The message and stack can
    // carry a DB detail, a decrypt failure, or other internals — never log them.
    // The redacted path locates the failure without leaking data.
    log({
      level: 'error',
      msg: 'request-error',
      method: request.method,
      path: redactPath(request.url.split('?')[0] ?? request.url),
      status,
      error: error.name,
    });
    return reply
      .code(status)
      .type('text/html')
      .send(
        layout(
          status === 500 ? 'Something went wrong' : 'Request not processed',
          `<div class="empty" style="max-width:34rem;margin:2.5rem auto">
             <h3>${status === 500 ? 'Something went wrong on our end' : "That request couldn't be processed"}</h3>
             <p>${
               status === 500
                 ? 'We hit an unexpected error. Nothing about your data changed. Please try again in a moment.'
                 : 'The request was malformed or is no longer valid. Please go back and try again.'
             }</p>
             <a class="btn" href="/">Back to CostFlow</a>
           </div>`,
        ),
      );
  });

  // Unmatched routes get the branded 404, not Fastify's default JSON body.
  app.setNotFoundHandler((request, reply) => {
    log({
      level: 'info',
      msg: 'not-found',
      method: request.method,
      path: redactPath(request.url.split('?')[0] ?? request.url),
      status: 404,
    });
    return reply
      .code(404)
      .type('text/html')
      .send(
        layout(
          'Page not found',
          `<div class="empty" style="max-width:34rem;margin:2.5rem auto">
             <h3>We couldn't find that page</h3>
             <p>The link may be broken or the page may have moved.</p>
             <a class="btn" href="/">Back to CostFlow</a>
           </div>`,
        ),
      );
  });

  // Liveness: the process is up. No dependencies — a failing DB must not make
  // the platform kill a pod that could still recover. `commit` echoes the SHA
  // Railway injects at build time (null outside Railway) so "which commit is
  // production running?" is answerable without dashboard access.
  app.get('/healthz', async (_request, reply) => {
    return reply
      .header('cache-control', 'no-store')
      .send({ status: 'ok', commit: process.env['RAILWAY_GIT_COMMIT_SHA'] ?? null });
  });

  // Readiness: dependencies are reachable. 503 sheds traffic until the DB is
  // back, without killing the process.
  app.get('/readyz', async (_request, reply) => {
    try {
      await context.store.ping();
      return reply.header('cache-control', 'no-store').send({ status: 'ready' });
    } catch {
      return reply.code(503).header('cache-control', 'no-store').send({ status: 'unavailable' });
    }
  });
}
