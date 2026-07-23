import { describe, expect, it } from 'vitest';
import type { TelemetryEvent } from '@costflow/telemetry';
import { buildServer } from '../src/server';
import { loadConfig } from '../src/config';
import { securityHeaders } from '../src/security';
import { MemoryStore } from '../src/store/memory';
import {
  SESSION_KEY,
  CREDENTIAL_KEY,
  TOKEN,
  makeApp,
  post,
  signIn,
  stubConnectors,
} from './helpers';

describe('security headers + CSP (doc 09 P4.2 §2)', () => {
  it('every response carries strict CSP and hardening headers', async () => {
    const t = makeApp({ production: true });
    const cookie = await signIn(t, 'h@b.example');
    const response = await t.app.inject({ method: 'GET', url: '/connect', headers: { cookie } });
    expect(response.headers['content-security-policy']).toContain("script-src 'none'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
  });

  it('HSTS is production-only (no false HTTPS promise in dev)', () => {
    expect(securityHeaders(false)['Strict-Transport-Security']).toBeUndefined();
    expect(securityHeaders(true)['Strict-Transport-Security']).toBeDefined();
  });
});

describe('health + readiness probes (doc 09 P4.2 §4)', () => {
  it('/healthz is public and always ok while the process is up', async () => {
    const t = makeApp();
    const response = await t.app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('/readyz reflects store reachability (200 ready, 503 when the store is down)', async () => {
    const t = makeApp();
    expect((await t.app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);

    const brokenStore = new MemoryStore();
    brokenStore.ping = async () => {
      throw new Error('db down');
    };
    const events: TelemetryEvent[] = [];
    const app = buildServer({
      store: brokenStore,
      connectors: stubConnectors(),
      auth: { mode: 'dev', sessionKey: SESSION_KEY, credentialKey: CREDENTIAL_KEY },
      telemetry: (e) => events.push(e),
    });
    const down = await app.inject({ method: 'GET', url: '/readyz' });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toEqual({ status: 'unavailable' });
  });
});

describe('secure cookies (doc 09 P4.2 §3)', () => {
  it('session cookie is Secure + HttpOnly + SameSite in production', async () => {
    const t = makeApp({
      auth: {
        mode: 'dev',
        sessionKey: SESSION_KEY,
        credentialKey: CREDENTIAL_KEY,
        secureCookies: true,
      },
    });
    const response = await t.app.inject({
      method: 'POST',
      url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=sec%40b.example',
    });
    const setCookie = response.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(raw).toContain('cf_session=');
    expect(raw).toMatch(/Secure/);
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Lax/);
  });
});

describe('sanitized operational logging (doc 09 P4.2 §5)', () => {
  it('logs method/path/status/duration and NEVER the token or body', async () => {
    const lines: Record<string, unknown>[] = [];
    const t = makeApp({ logSink: (line) => lines.push(line) });
    const cookie = await signIn(t, 'log@b.example');
    // POST a body carrying the secret token; the log line must not echo it.
    await post(t, cookie, '/connect', {
      provider: 'jira',
      site: 'https://log.atlassian.net',
      email: 'log@b.example',
      token: TOKEN,
    });
    const connectLog = lines.find((l) => l['path'] === '/connect');
    expect(connectLog).toBeDefined();
    expect(connectLog).toMatchObject({ msg: 'request', method: 'POST', path: '/connect' });
    expect(typeof connectLog!['durationMs']).toBe('number');
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('log@b.example');
  });
});

describe('sign-out (doc 09 P4.2 §6)', () => {
  it('clears the session and forces re-authentication', async () => {
    const t = makeApp({
      auth: {
        mode: 'dev',
        sessionKey: SESSION_KEY,
        credentialKey: CREDENTIAL_KEY,
        secureCookies: false,
      },
    });
    const cookie = await signIn(t, 'out@b.example');
    const logout = await post(t, cookie, '/logout', {});
    expect(logout.statusCode).toBe(302);
    expect(logout.headers['location']).toBe('/logged-out');
    const cleared = String(logout.headers['set-cookie']);
    expect(cleared).toContain('cf_session=');
    // The cleared cookie no longer authenticates: a protected page redirects.
    const after = await t.app.inject({
      method: 'GET',
      url: '/connect',
      headers: { cookie: 'cf_session=' },
    });
    expect(after.statusCode).toBe(302);
    expect(after.headers['location']).toBe('/login');
  });

  it('logout requires the CSRF token when a session is present', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'csrf@b.example');
    const response = await t.app.inject({
      method: 'POST',
      url: '/logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      payload: 'csrf=wrong',
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('startup validation (doc 09 P4.2 §1)', () => {
  const keys = {
    COSTFLOW_SESSION_KEY: Buffer.alloc(32, 1).toString('base64'),
    COSTFLOW_CREDENTIAL_KEY: Buffer.alloc(32, 2).toString('base64'),
  };

  it('refuses to boot without valid keys', () => {
    expect(() => loadConfig({ COSTFLOW_AUTH: 'dev', COSTFLOW_STORE: 'memory' })).toThrow(
      /COSTFLOW_SESSION_KEY/,
    );
    expect(() =>
      loadConfig({
        ...keys,
        COSTFLOW_SESSION_KEY: 'short',
        COSTFLOW_AUTH: 'dev',
        COSTFLOW_STORE: 'memory',
      }),
    ).toThrow(/32 bytes/);
  });

  it('production refuses dev auth, memory store, and a missing database', () => {
    const base = { ...keys, COSTFLOW_ENV: 'production' };
    expect(() =>
      loadConfig({ ...base, COSTFLOW_AUTH: 'dev', DATABASE_URL: 'postgres://x' }),
    ).toThrow(/dev is refused in production/);
    expect(() =>
      loadConfig({
        ...base,
        COSTFLOW_AUTH: 'oidc',
        COSTFLOW_OIDC_ISSUER: 'https://idp',
        COSTFLOW_OIDC_CLIENT_ID: 'c',
        COSTFLOW_OIDC_CLIENT_SECRET: 's',
        COSTFLOW_OIDC_REDIRECT_URI: 'https://app/cb',
      }),
    ).toThrow(/DATABASE_URL is required in production/);
    expect(() =>
      loadConfig({
        ...base,
        COSTFLOW_AUTH: 'oidc',
        COSTFLOW_OIDC_ISSUER: 'https://idp',
        COSTFLOW_OIDC_CLIENT_ID: 'c',
        COSTFLOW_OIDC_CLIENT_SECRET: 's',
        COSTFLOW_OIDC_REDIRECT_URI: 'https://app/cb',
        COSTFLOW_STORE: 'memory',
        DATABASE_URL: 'postgres://x',
      }),
    ).toThrow(/memory is refused in production/);
  });

  it('production forces secure cookies + trusted proxy; dev leaves them off', () => {
    const prod = loadConfig({
      ...keys,
      COSTFLOW_ENV: 'production',
      COSTFLOW_AUTH: 'oidc',
      COSTFLOW_OIDC_ISSUER: 'https://idp',
      COSTFLOW_OIDC_CLIENT_ID: 'c',
      COSTFLOW_OIDC_CLIENT_SECRET: 's',
      COSTFLOW_OIDC_REDIRECT_URI: 'https://app/cb',
      DATABASE_URL: 'postgres://x',
    });
    expect(prod).toMatchObject({ production: true, secureCookies: true, trustProxy: true });
    expect(prod.auth.secureCookies).toBe(true);

    const dev = loadConfig({ ...keys, COSTFLOW_AUTH: 'dev', COSTFLOW_STORE: 'memory' });
    expect(dev).toMatchObject({ production: false, secureCookies: false, trustProxy: false });
  });
});
