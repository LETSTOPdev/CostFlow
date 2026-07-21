import type { FastifyInstance } from 'fastify';
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
  /** Structured log sink; defaults to stdout JSON. Injected for tests. */
  readonly logSink?: (line: Record<string, unknown>) => void;
}

export function securityHeaders(production: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': [
      "default-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
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

export function registerSecurity(app: FastifyInstance, context: SecurityContext): void {
  const log = context.logSink ?? ((line) => console.log(JSON.stringify(line)));
  const headers = securityHeaders(context.production);

  app.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(headers)) {
      reply.header(name, value);
    }
    return payload;
  });

  // Sanitized operational logging (plan §5): method, path (no query string —
  // it could otherwise capture ids), status, duration. NEVER bodies, headers,
  // tokens, emails, or customer vocabulary.
  app.addHook('onResponse', async (request, reply) => {
    const path = request.url.split('?')[0];
    log({
      level: 'info',
      msg: 'request',
      method: request.method,
      path,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    });
  });

  // Liveness: the process is up. No dependencies — a failing DB must not make
  // the platform kill a pod that could still recover.
  app.get('/healthz', async (_request, reply) => {
    return reply.header('cache-control', 'no-store').send({ status: 'ok' });
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
