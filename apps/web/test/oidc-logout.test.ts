import { describe, expect, it } from 'vitest';
import { oidcLogoutUrl } from '../src/auth';
import { derivePostLogoutRedirectUri, loadConfig } from '../src/config';

/**
 * P4.2 Gate 2 — RP-initiated logout URL construction + config validation.
 * (End-to-end behavior is covered in auth-oidc.test.ts; dev-mode local logout
 * in logout.test.ts / hardening.test.ts.)
 */

describe('oidcLogoutUrl (RP-initiated end-session)', () => {
  it('targets the OIDC /oidc/logout endpoint with client_id and encoded redirect', () => {
    const url = oidcLogoutUrl({
      issuer: 'https://dev-abc.us.auth0.com/',
      clientId: 'client-123',
      postLogoutRedirectUri: 'https://app.fbx1.com/logged-out',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://dev-abc.us.auth0.com/oidc/logout');
    expect(url).not.toContain('/v2/logout'); // prefer OIDC-compliant endpoint
    expect(parsed.searchParams.get('client_id')).toBe('client-123');
    expect(parsed.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://app.fbx1.com/logged-out',
    );
    expect(url).toContain(
      `post_logout_redirect_uri=${encodeURIComponent('https://app.fbx1.com/logged-out')}`,
    );
    // No federated logout — Auth0 tenant session only, not the upstream account.
    expect(parsed.searchParams.get('federated')).toBeNull();
    // Never carries an id_token or code.
    expect(parsed.searchParams.get('id_token_hint')).toBeNull();
  });

  it('handles an issuer without a trailing slash', () => {
    const url = oidcLogoutUrl({
      issuer: 'https://dev-abc.us.auth0.com',
      clientId: 'c',
      postLogoutRedirectUri: 'https://app.fbx1.com/logged-out',
    });
    expect(url.startsWith('https://dev-abc.us.auth0.com/oidc/logout?')).toBe(true);
  });
});

describe('derivePostLogoutRedirectUri (config validation)', () => {
  it('derives /logged-out from the callback URL origin (existing config model)', () => {
    expect(derivePostLogoutRedirectUri(undefined, 'https://app.fbx1.com/auth/callback', true)).toBe(
      'https://app.fbx1.com/logged-out',
    );
  });

  it('prefers an explicit COSTFLOW_PUBLIC_URL', () => {
    expect(
      derivePostLogoutRedirectUri('https://app.fbx1.com', 'https://ignored/auth/callback', true),
    ).toBe('https://app.fbx1.com/logged-out');
  });

  it('fails safely on an unparseable base URL', () => {
    expect(() => derivePostLogoutRedirectUri(undefined, 'not-a-url', true)).toThrow(
      /not a valid absolute URL/,
    );
  });

  it('requires https in production', () => {
    expect(() =>
      derivePostLogoutRedirectUri('http://app.fbx1.com', 'https://x/auth/callback', true),
    ).toThrow(/must be https in production/);
    // http is tolerated outside production (local dev).
    expect(derivePostLogoutRedirectUri('http://localhost:3000', 'http://x/cb', false)).toBe(
      'http://localhost:3000/logged-out',
    );
  });
});

describe('loadConfig wires the post-logout redirect into the OIDC config', () => {
  const base = {
    COSTFLOW_SESSION_KEY: Buffer.alloc(32, 1).toString('base64'),
    COSTFLOW_CREDENTIAL_KEY: Buffer.alloc(32, 2).toString('base64'),
    COSTFLOW_ENV: 'production',
    COSTFLOW_AUTH: 'oidc',
    COSTFLOW_OIDC_ISSUER: 'https://dev-abc.us.auth0.com/',
    COSTFLOW_OIDC_CLIENT_ID: 'client-123',
    COSTFLOW_OIDC_CLIENT_SECRET: 's',
    COSTFLOW_OIDC_REDIRECT_URI: 'https://app.fbx1.com/auth/callback',
    DATABASE_URL: 'postgres://x',
  };

  it('populates a validated postLogoutRedirectUri', () => {
    const config = loadConfig(base);
    expect(config.auth.oidc?.postLogoutRedirectUri).toBe('https://app.fbx1.com/logged-out');
  });

  it('fails to boot when the redirect URI cannot yield a valid base', () => {
    expect(() => loadConfig({ ...base, COSTFLOW_OIDC_REDIRECT_URI: 'garbage' })).toThrow(
      /not a valid absolute URL/,
    );
  });
});
