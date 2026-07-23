import { requireKey } from './crypto';
import type { AuthConfig } from './auth';

/**
 * Startup validation (doc 09 P4.2 §1): one typed loader that refuses to boot
 * on any misconfiguration with a named message — the server never limps.
 * Production (COSTFLOW_ENV=production) is strict: managed OIDC only, a real
 * database (memory store forbidden), and secure cookies + trusted proxy
 * forced on (Railway terminates TLS and proxies).
 */
export interface AppConfig {
  readonly port: number;
  readonly production: boolean;
  readonly auth: AuthConfig;
  readonly databaseUrl: string | null;
  readonly useMemoryStore: boolean;
  readonly secureCookies: boolean;
  readonly trustProxy: boolean;
  /** Emails allowed to view the founder analytics page (COSTFLOW_ADMIN_EMAILS). */
  readonly adminEmails: string[];
  /** Max work items imported per scope, any provider (COSTFLOW_MAX_ISSUES); undefined → server default. */
  readonly maxIssues: number | undefined;
}

export type Env = Record<string, string | undefined>;

/**
 * The public `/logged-out` URL Auth0 returns to after RP-initiated logout.
 * Base URL comes from COSTFLOW_PUBLIC_URL if set, else the callback URL's
 * origin — no environment-specific host is hardcoded. Refuses to boot on an
 * unparseable base or (in production) a non-https URL.
 */
export function derivePostLogoutRedirectUri(
  publicUrl: string | undefined,
  redirectUri: string,
  production: boolean,
): string {
  let origin: string;
  try {
    origin = new URL(publicUrl ?? redirectUri).origin;
  } catch {
    throw new Error(
      'Cannot derive the post-logout redirect URL: COSTFLOW_PUBLIC_URL (or COSTFLOW_OIDC_REDIRECT_URI) is not a valid absolute URL.',
    );
  }
  const url = `${origin}/logged-out`;
  if (production && !url.startsWith('https://')) {
    throw new Error('The post-logout redirect URL must be https in production.');
  }
  return url;
}

export function loadConfig(env: Env): AppConfig {
  const production = env['COSTFLOW_ENV'] === 'production';
  const sessionKey = requireKey(env['COSTFLOW_SESSION_KEY'], 'COSTFLOW_SESSION_KEY');
  const credentialKey = requireKey(env['COSTFLOW_CREDENTIAL_KEY'], 'COSTFLOW_CREDENTIAL_KEY');

  // In production, cookies are Secure and the app trusts the edge proxy.
  const secureCookies = production;
  const trustProxy = production;

  const authMode = env['COSTFLOW_AUTH'];
  let auth: AuthConfig;
  if (authMode === 'oidc') {
    const issuer = env['COSTFLOW_OIDC_ISSUER'];
    const clientId = env['COSTFLOW_OIDC_CLIENT_ID'];
    const clientSecret = env['COSTFLOW_OIDC_CLIENT_SECRET'];
    const redirectUri = env['COSTFLOW_OIDC_REDIRECT_URI'];
    if (!issuer || !clientId || !clientSecret || !redirectUri) {
      throw new Error(
        'COSTFLOW_AUTH=oidc requires COSTFLOW_OIDC_ISSUER, _CLIENT_ID, _CLIENT_SECRET, _REDIRECT_URI.',
      );
    }
    // Derive the public post-logout redirect URL from the application base URL.
    // Prefer an explicit COSTFLOW_PUBLIC_URL; otherwise use the callback URL's
    // origin (the existing config model) — never a hardcoded host. Validated
    // here so a bad value fails safely at boot, not at logout time.
    const postLogoutRedirectUri = derivePostLogoutRedirectUri(
      env['COSTFLOW_PUBLIC_URL'],
      redirectUri,
      production,
    );
    auth = {
      mode: 'oidc',
      sessionKey,
      credentialKey,
      secureCookies,
      oidc: { issuer, clientId, clientSecret, redirectUri, postLogoutRedirectUri },
    };
  } else if (authMode === 'dev') {
    if (production) {
      throw new Error('COSTFLOW_AUTH=dev is refused in production — configure managed OIDC.');
    }
    auth = { mode: 'dev', sessionKey, credentialKey, secureCookies };
  } else {
    throw new Error('COSTFLOW_AUTH must be "oidc" (managed identity provider) or "dev".');
  }

  const databaseUrl = env['DATABASE_URL'] ?? null;
  const useMemoryStore = env['COSTFLOW_STORE'] === 'memory';
  if (production && !databaseUrl) {
    throw new Error('DATABASE_URL is required in production.');
  }
  if (production && useMemoryStore) {
    throw new Error('COSTFLOW_STORE=memory is refused in production — data must persist.');
  }
  if (!databaseUrl && !useMemoryStore) {
    throw new Error('DATABASE_URL is required (or COSTFLOW_STORE=memory for a throwaway demo).');
  }

  const adminEmails = (env['COSTFLOW_ADMIN_EMAILS'] ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email !== '');
  const rawMax = env['COSTFLOW_MAX_ISSUES'];
  const parsedMax = rawMax !== undefined && /^\d+$/.test(rawMax) ? Number(rawMax) : undefined;
  const maxIssues = parsedMax !== undefined && parsedMax > 0 ? parsedMax : undefined;

  return {
    port: Number(env['PORT'] ?? 3000),
    production,
    auth,
    databaseUrl,
    useMemoryStore,
    secureCookies,
    trustProxy,
    adminEmails,
    maxIssues,
  };
}
