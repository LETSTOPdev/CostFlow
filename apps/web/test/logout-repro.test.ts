import { describe, expect, it } from 'vitest';
import { makeApp } from './helpers';

/**
 * P4.2 Gate 2 — faithful browser cookie-jar reproduction of the rendered
 * logout form + CSRF flow through the full OIDC lifecycle. This does NOT
 * construct tokens by hand: it parses the EXACT rendered <form action="/logout">
 * (method, hidden inputs, token) and submits those exact fields with a cookie
 * jar that accumulates Set-Cookie exactly like a browser.
 */

/** Minimal browser-like cookie jar over Fastify inject responses. */
class Jar {
  private cookies = new Map<string, string>();
  apply(res: { headers: Record<string, unknown> }): void {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
    for (const c of list) {
      const pair = c.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  has(name: string): boolean {
    return this.cookies.has(name);
  }
}

interface ParsedForm {
  action: string;
  method: string;
  fields: Record<string, string>;
}

/** Extract the <form action="/logout"> exactly as rendered, with its hidden inputs. */
function parseLogoutForm(html: string): ParsedForm {
  const form = /<form\b[^>]*action="\/logout"[^>]*>([\s\S]*?)<\/form>/i.exec(html);
  if (!form) throw new Error('no /logout form found in rendered HTML');
  const openTag = /<form\b([^>]*)>/i.exec(form[0])?.[1] ?? '';
  const method = (/method="([^"]+)"/i.exec(openTag)?.[1] ?? 'get').toLowerCase();
  const fields: Record<string, string> = {};
  const inputRe = /<input\b[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = inputRe.exec(form[1] as string)) !== null) {
    fields[m[1] as string] = m[2] as string;
  }
  return { action: '/logout', method, fields };
}

const oidc = {
  issuer: 'https://idp.example',
  clientId: 'costflow',
  clientSecret: 'cs-secret',
  redirectUri: 'https://app.costflow.example/auth/callback',
  postLogoutRedirectUri: 'https://app.costflow.example/logged-out',
};

function stubIdp(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration')) {
      return new Response(
        JSON.stringify({
          authorization_endpoint: 'https://idp.example/authorize',
          token_endpoint: 'https://idp.example/token',
          userinfo_endpoint: 'https://idp.example/userinfo',
        }),
      );
    }
    if (url === 'https://idp.example/token')
      return new Response(JSON.stringify({ access_token: 'at-1' }));
    if (url === 'https://idp.example/userinfo') {
      void init;
      return new Response(JSON.stringify({ email: 'user@acme.example' }));
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

describe('faithful browser logout (OIDC lifecycle + real rendered form + cookie jar)', () => {
  function app(logs: Record<string, unknown>[] = []) {
    return makeApp({
      auth: {
        mode: 'oidc',
        sessionKey: Buffer.alloc(32, 7),
        credentialKey: Buffer.alloc(32, 9),
        secureCookies: true,
        oidc,
        fetchFn: stubIdp(),
      },
      logSink: (l) => logs.push(l),
    });
  }

  async function signInWithJar(t: ReturnType<typeof app>, jar: Jar) {
    const login = await t.app.inject({ method: 'GET', url: '/login' });
    jar.apply(login);
    const state = new URL(login.headers['location'] as string).searchParams.get('state');
    const callback = await t.app.inject({
      method: 'GET',
      url: `/auth/callback?code=good-code&state=${state}`,
      headers: { cookie: jar.header() },
    });
    jar.apply(callback);
  }

  it('renders a token, then that exact form + jar POSTs successfully to Auth0 /oidc/logout', async () => {
    const logs: Record<string, unknown>[] = [];
    const t = app(logs);
    const jar = new Jar();
    await signInWithJar(t, jar);
    expect(jar.has('cf_session')).toBe(true); // session committed by the callback

    // Render an authenticated page with the jar; parse the ACTUAL form.
    const connect = await t.app.inject({
      method: 'GET',
      url: '/connect',
      headers: { cookie: jar.header() },
    });
    expect(connect.statusCode).toBe(200);
    const form = parseLogoutForm(connect.body);
    expect(form.method).toBe('post');
    expect(form.fields['csrf']).toBeTruthy(); // hidden csrf present, name matches validator

    // Submit EXACTLY the rendered fields with the EXACT jar cookies.
    const logout = await t.app.inject({
      method: 'POST',
      url: form.action,
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
      payload: new URLSearchParams(form.fields).toString(),
    });
    jar.apply(logout);

    // CSRF passed → redirect to Auth0 end-session (not 403, not the same page).
    expect(logout.statusCode, `expected 302, got ${logout.statusCode}: ${logout.body}`).toBe(302);
    expect(new URL(logout.headers['location'] as string).pathname).toBe('/oidc/logout');

    // Diagnostics prove the CSRF matched using the rendered token.
    const diag = logs.find((l) => l['msg'] === 'logout-attempt');
    expect(diag).toMatchObject({ session_present: true, csrf_present: true, csrf_match: true });

    // The jar's cf_session was cleared → a protected route is no longer authenticated.
    expect(jar.has('cf_session')).toBe(false);
    const after = await t.app.inject({
      method: 'GET',
      url: '/connect',
      headers: { cookie: jar.header() },
    });
    expect(after.statusCode).toBe(302);
    expect(after.headers['location']).toBe('/login');

    // No raw csrf/session value in logs (booleans only).
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(form.fields['csrf']);
  });

  it('a stale token (from a previous session) fails with 403 and does not log out', async () => {
    const t = app();
    const jar = new Jar();
    await signInWithJar(t, jar);
    const connect = await t.app.inject({
      method: 'GET',
      url: '/connect',
      headers: { cookie: jar.header() },
    });
    const staleForm = { csrf: 'stale-00000000-0000-0000-0000-000000000000' };
    const logout = await t.app.inject({
      method: 'POST',
      url: '/logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
      payload: new URLSearchParams(staleForm).toString(),
    });
    expect(logout.statusCode).toBe(403);
    // Still authenticated (not logged out) — session intact.
    void connect;
    const still = await t.app.inject({
      method: 'GET',
      url: '/connect',
      headers: { cookie: jar.header() },
    });
    expect(still.statusCode).toBe(200);
  });
});
