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
});
