import { describe, expect, it } from 'vitest';
import { cookieOf, makeApp } from './helpers';

/**
 * OIDC adapter (doc 09 P4.1 plan §1): authorization-code flow against a
 * stubbed managed IdP — discovery, state round-trip, code exchange,
 * userinfo → session. No passwords ever touch CostFlow.
 */
describe('managed authentication (OIDC adapter)', () => {
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
      if (url === 'https://idp.example/.well-known/openid-configuration') {
        return new Response(
          JSON.stringify({
            authorization_endpoint: 'https://idp.example/authorize',
            token_endpoint: 'https://idp.example/token',
            userinfo_endpoint: 'https://idp.example/userinfo',
          }),
        );
      }
      if (url === 'https://idp.example/token') {
        const body = String(init?.body ?? '');
        if (!body.includes('code=good-code') || !body.includes('client_secret=cs-secret')) {
          return new Response('{}', { status: 400 });
        }
        return new Response(JSON.stringify({ access_token: 'at-1' }));
      }
      if (url === 'https://idp.example/userinfo') {
        const auth = (init?.headers as Record<string, string>)?.['Authorization'];
        if (auth !== 'Bearer at-1') return new Response('{}', { status: 401 });
        return new Response(JSON.stringify({ email: 'Managed@Acme.Example' }));
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
  }

  it('signs a user in via the managed IdP and provisions the tenant', async () => {
    const t = makeApp({
      auth: {
        mode: 'oidc',
        sessionKey: Buffer.alloc(32, 1),
        credentialKey: Buffer.alloc(32, 2),
        oidc,
        fetchFn: stubIdp(),
      },
    });
    const login = await t.app.inject({ method: 'GET', url: '/login' });
    expect(login.statusCode).toBe(302);
    const location = new URL(login.headers['location'] as string);
    expect(location.origin + location.pathname).toBe('https://idp.example/authorize');
    expect(location.searchParams.get('client_id')).toBe('costflow');
    const state = location.searchParams.get('state') as string;
    const stateCookie = cookieOf(login, 'cf_oidc_state');

    const callback = await t.app.inject({
      method: 'GET',
      url: `/auth/callback?code=good-code&state=${state}`,
      headers: { cookie: stateCookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers['location']).toBe('/');
    const session = cookieOf(callback, 'cf_session');
    expect(session.length).toBeGreaterThan(20);
    // email normalized; tenant provisioned
    expect(await t.store.findUserByEmail('managed@acme.example')).not.toBeNull();
    expect(t.events[0]).toMatchObject({ event: 'tm-web-signin', fields: { ok: true } });
  });

  it('/signup hands off to the IdP registration screen (screen_hint=signup)', async () => {
    const t = makeApp({
      auth: {
        mode: 'oidc',
        sessionKey: Buffer.alloc(32, 1),
        credentialKey: Buffer.alloc(32, 2),
        oidc,
        fetchFn: stubIdp(),
      },
    });
    const res = await t.app.inject({ method: 'GET', url: '/signup' });
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers['location'] as string);
    expect(location.origin + location.pathname).toBe('https://idp.example/authorize');
    expect(location.searchParams.get('screen_hint')).toBe('signup');
    // Same state round-trip as /login: the callback still validates.
    expect(cookieOf(res, 'cf_oidc_state').length).toBeGreaterThan(10);
  });

  it('rejects a callback with a mismatched state', async () => {
    const t = makeApp({
      auth: {
        mode: 'oidc',
        sessionKey: Buffer.alloc(32, 1),
        credentialKey: Buffer.alloc(32, 2),
        oidc,
        fetchFn: stubIdp(),
      },
    });
    const login = await t.app.inject({ method: 'GET', url: '/login' });
    const stateCookie = cookieOf(login, 'cf_oidc_state');
    const callback = await t.app.inject({
      method: 'GET',
      url: '/auth/callback?code=good-code&state=forged',
      headers: { cookie: stateCookie },
    });
    expect(callback.statusCode).toBe(400);
    expect(await t.store.findUserByEmail('managed@acme.example')).toBeNull();
  });

  it('sets the OIDC state cookie SameSite=None; Secure in production (survives the IdP callback)', async () => {
    const t = makeApp({
      auth: {
        mode: 'oidc',
        sessionKey: Buffer.alloc(32, 1),
        credentialKey: Buffer.alloc(32, 2),
        secureCookies: true, // production posture
        oidc,
        fetchFn: stubIdp(),
      },
    });
    const login = await t.app.inject({ method: 'GET', url: '/login' });
    const setCookie = login.headers['set-cookie'];
    const line = (Array.isArray(setCookie) ? setCookie : [String(setCookie)]).find((c) =>
      c.startsWith('cf_oidc_state='),
    )!;
    // Lax would be dropped on the cross-site signup callback → "Invalid sign-in state".
    expect(line).toContain('SameSite=None');
    expect(line).toContain('Secure');
    expect(line).toContain('HttpOnly');
  });

  it('surfaces an explicit IdP error (e.g. access_denied) instead of "invalid state"', async () => {
    const logs: Record<string, unknown>[] = [];
    const t = makeApp({
      auth: {
        mode: 'oidc',
        sessionKey: Buffer.alloc(32, 1),
        credentialKey: Buffer.alloc(32, 2),
        oidc,
        fetchFn: stubIdp(),
      },
      logSink: (line) => logs.push(line),
    });
    const login = await t.app.inject({ method: 'GET', url: '/login' });
    const callback = await t.app.inject({
      method: 'GET',
      url: '/auth/callback?error=access_denied&error_description=Please%20verify%20your%20email',
      headers: { cookie: cookieOf(login, 'cf_oidc_state') },
    });
    expect(callback.statusCode).toBe(400);
    expect(callback.body).toContain('access_denied');
    expect(callback.body).toContain('Please verify your email'); // the IdP reason is shown
    expect(callback.body).not.toContain('Invalid sign-in state');
    // Sanitized diagnostic: booleans + the error CODE + description (the reason).
    const diag = logs.find((l) => l['msg'] === 'oidc-callback');
    expect(diag).toMatchObject({
      code_present: false,
      error: 'access_denied',
      error_description: 'Please verify your email',
    });
    expect(await t.store.findUserByEmail('managed@acme.example')).toBeNull();
  });

  it('RP-initiated logout: clears local session, then redirects to Auth0 /oidc/logout (P4.2 Gate 2)', async () => {
    const logs: Record<string, unknown>[] = [];
    const t = makeApp({
      auth: {
        mode: 'oidc',
        sessionKey: Buffer.alloc(32, 1),
        credentialKey: Buffer.alloc(32, 2),
        secureCookies: true,
        oidc,
        fetchFn: stubIdp(),
      },
      logSink: (line) => logs.push(line),
    });
    // Sign in via OIDC.
    const login = await t.app.inject({ method: 'GET', url: '/login' });
    const state = new URL(login.headers['location'] as string).searchParams.get('state');
    const callback = await t.app.inject({
      method: 'GET',
      url: `/auth/callback?code=good-code&state=${state}`,
      headers: { cookie: cookieOf(login, 'cf_oidc_state') },
    });
    const session = cookieOf(callback, 'cf_session');

    const connect = await t.app.inject({
      method: 'GET',
      url: '/connect',
      headers: { cookie: session },
    });
    const csrf = /name="csrf" value="([^"]+)"/.exec(connect.body)?.[1] as string;
    const logout = await t.app.inject({
      method: 'POST',
      url: '/logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: session },
      payload: `csrf=${encodeURIComponent(csrf)}`,
    });

    // Redirects to the OIDC-compliant end-session endpoint (not the local page,
    // not /login, not the legacy /v2/logout).
    expect(logout.statusCode).toBe(302);
    const location = logout.headers['location'] as string;
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe('https://idp.example/oidc/logout');
    expect(location).not.toContain('/v2/logout');
    // Correct client_id + encoded post_logout_redirect_uri.
    expect(url.searchParams.get('client_id')).toBe('costflow');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://app.costflow.example/logged-out',
    );
    expect(location).toContain(
      `post_logout_redirect_uri=${encodeURIComponent('https://app.costflow.example/logged-out')}`,
    );
    // No federated logout by default (do not sign the user out of Google).
    expect(url.searchParams.get('federated')).toBeNull();

    // Local session invalidated on the SAME response, before the external hop.
    const cleared = cookieOf(logout, 'cf_session'); // cf_session=; Expires=1970...
    const after = await t.app.inject({
      method: 'GET',
      url: '/connect',
      headers: { cookie: cleared },
    });
    expect(after.statusCode).toBe(302);
    expect(after.headers['location']).toBe('/login');

    // No OIDC value (client_id, redirect uri, tokens, state) appears in logs —
    // request logging records path only, never the redirect Location or query.
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain('costflow'); // client_id
    expect(serialized).not.toContain('post_logout_redirect_uri');
    expect(serialized).not.toContain('logged-out');
    expect(serialized).not.toContain('at-1'); // access token
    expect(serialized).not.toContain('good-code'); // auth code
  });
});

/**
 * R15 — an account IS its email address, so the address has to be proven.
 *
 * `signInByEmail` resolves an existing user by email alone. An identity that
 * asserts someone else's address therefore resolves to that person's session
 * and tenant, and the only thing between those two facts is whether the
 * provider verified the address. The `email_verified` claim was read here and
 * spent on analytics.
 *
 * The intent was to delegate this to an Auth0 Action. That is a setting in a
 * tenant this repository cannot read, on a tenant nobody has hardened (R14), so
 * the guard lives in the application where a test can hold it.
 */
describe('R15: sign-in requires a verified email address', () => {
  const oidc = {
    issuer: 'https://idp.example',
    clientId: 'costflow',
    clientSecret: 'cs-secret',
    redirectUri: 'https://app.costflow.example/auth/callback',
    postLogoutRedirectUri: 'https://app.costflow.example/logged-out',
  };

  /** Same stub as above, with the verification claim under the test's control. */
  function stubIdp(claim: { email_verified?: boolean }): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://idp.example/.well-known/openid-configuration') {
        return new Response(
          JSON.stringify({
            authorization_endpoint: 'https://idp.example/authorize',
            token_endpoint: 'https://idp.example/token',
            userinfo_endpoint: 'https://idp.example/userinfo',
          }),
        );
      }
      if (url === 'https://idp.example/token') {
        const body = String(init?.body ?? '');
        if (!body.includes('code=good-code')) return new Response('{}', { status: 400 });
        return new Response(JSON.stringify({ access_token: 'at-1' }));
      }
      if (url === 'https://idp.example/userinfo') {
        return new Response(JSON.stringify({ email: 'victim@acme.example', ...claim }));
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
  }

  /** True when the response set no session cookie at all. */
  const noSession = (res: { headers: Record<string, unknown> }): boolean => {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw as string];
    return !list.some((c) => typeof c === 'string' && c.startsWith('cf_session='));
  };

  async function callback(claim: { email_verified?: boolean }) {
    const t = makeApp({
      auth: {
        mode: 'oidc',
        sessionKey: Buffer.alloc(32, 1),
        credentialKey: Buffer.alloc(32, 2),
        oidc,
        fetchFn: stubIdp(claim),
      },
    });
    const login = await t.app.inject({ method: 'GET', url: '/login' });
    const state = new URL(login.headers['location'] as string).searchParams.get('state') as string;
    const res = await t.app.inject({
      method: 'GET',
      url: `/auth/callback?code=good-code&state=${state}`,
      headers: { cookie: cookieOf(login, 'cf_oidc_state') },
    });
    return { t, res };
  }

  it('refuses when the provider says the address is unverified', async () => {
    const { t, res } = await callback({ email_verified: false });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('Verify your email');
    // No session, and no account brought into existence by the attempt.
    expect(noSession(res)).toBe(true);
    expect(await t.store.findUserByEmail('victim@acme.example')).toBeNull();
    expect(t.events[0]).toMatchObject({ event: 'tm-web-signin', fields: { ok: false } });
  });

  it('an unverified identity cannot take over an existing account', async () => {
    // The account exists and is legitimately someone's.
    const seed = await callback({ email_verified: true });
    expect(seed.res.statusCode).toBe(302);
    const owner = await seed.t.store.findUserByEmail('victim@acme.example');
    expect(owner).not.toBeNull();

    // A second identity asserts the same address without verification.
    const attack = await callback({ email_verified: false });
    expect(attack.res.statusCode).toBe(403);
    expect(noSession(attack.res)).toBe(true);
  });

  it('signs in when the provider confirms the address', async () => {
    const { t, res } = await callback({ email_verified: true });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/');
    expect(cookieOf(res, 'cf_session').length).toBeGreaterThan(20);
    expect(await t.store.findUserByEmail('victim@acme.example')).not.toBeNull();
  });

  /**
   * Absent is not false. A provider that omits the claim has said nothing about
   * the address; refusing on silence would lock out every user of an IdP that
   * does not send it, which is a worse failure than the one being prevented.
   */
  it('signs in when the provider sends no verification claim at all', async () => {
    const { t, res } = await callback({});
    expect(res.statusCode).toBe(302);
    expect(cookieOf(res, 'cf_session').length).toBeGreaterThan(20);
    expect(await t.store.findUserByEmail('victim@acme.example')).not.toBeNull();
  });

  it('logs the refusal without the address', async () => {
    const t = makeApp({
      auth: {
        mode: 'oidc',
        sessionKey: Buffer.alloc(32, 1),
        credentialKey: Buffer.alloc(32, 2),
        oidc,
        fetchFn: stubIdp({ email_verified: false }),
      },
    });
    const login = await t.app.inject({ method: 'GET', url: '/login' });
    const state = new URL(login.headers['location'] as string).searchParams.get('state') as string;
    await t.app.inject({
      method: 'GET',
      url: `/auth/callback?code=good-code&state=${state}`,
      headers: { cookie: cookieOf(login, 'cf_oidc_state') },
    });
    expect(t.logs.some((l) => l['msg'] === 'signin-refused')).toBe(true);
    expect(JSON.stringify(t.logs)).not.toContain('victim@acme.example');
  });
});
