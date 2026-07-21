import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { encryptSecret, newId, newSalt, signValue, verifyValue } from './crypto';
import type { Store } from './store/contract';

/**
 * Authentication (doc 09 P4.1 plan §1). CostFlow never stores passwords.
 * Two adapters behind one session model:
 *  - 'oidc': authorization-code flow against any managed IdP (issuer
 *    discovery, code exchange, userinfo) — the production path;
 *  - 'dev': explicitly-gated email-only sign-in for local/test.
 * Both end in the same signed session cookie {userId, tenantId, csrf}.
 */

export const SESSION_COOKIE = 'cf_session';

export interface Session {
  readonly userId: string;
  readonly tenantId: string;
  readonly csrf: string;
}

export interface AuthConfig {
  readonly mode: 'dev' | 'oidc';
  readonly sessionKey: Buffer;
  readonly credentialKey: Buffer;
  /** Set the Secure attribute on session/state cookies (production/HTTPS). */
  readonly secureCookies?: boolean;
  readonly oidc?: {
    readonly issuer: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly redirectUri: string;
  };
  /** Injected so tests can stub the IdP; defaults to global fetch. */
  readonly fetchFn?: typeof fetch;
}

export function sessionFrom(request: FastifyRequest, key: Buffer): Session | null {
  const raw = request.cookies[SESSION_COOKIE];
  return verifyValue<Session>(raw, key);
}

export function setSession(
  reply: FastifyReply,
  session: Session,
  key: Buffer,
  secure = false,
): void {
  reply.setCookie(SESSION_COOKIE, signValue(session, key), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
  });
}

export function clearSession(reply: FastifyReply, secure = false): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure });
}

/** Finds or creates the user + tenant (first sign-in provisions the tenant + encrypted salt). */
export async function signInByEmail(
  store: Store,
  credentialKey: Buffer,
  email: string,
): Promise<Session> {
  const existing = await store.findUserByEmail(email);
  if (existing) {
    return { userId: existing.id, tenantId: existing.tenantId, csrf: newId() };
  }
  const saltCiphertext = encryptSecret(newSalt(), credentialKey);
  const { user } = await store.createTenantWithUser(email, saltCiphertext);
  return { userId: user.id, tenantId: user.tenantId, csrf: newId() };
}

interface OidcDiscovery {
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  config: AuthConfig,
  store: Store,
  onSignIn: (ok: boolean) => void,
): void {
  if (config.mode === 'dev') {
    app.get('/login', async (_request, reply) => {
      return reply.type('text/html').send(
        `<!doctype html><title>CostFlow — sign in</title>
         <h1>Sign in (development mode)</h1>
         <form method="post" action="/login">
           <label>Email <input name="email" type="email" required></label>
           <button type="submit">Sign in</button>
         </form>`,
      );
    });
    app.post('/login', async (request, reply) => {
      const email = ((request.body as { email?: string })?.email ?? '').trim().toLowerCase();
      if (!email) {
        onSignIn(false);
        return reply.code(400).send('Email required.');
      }
      const session = await signInByEmail(store, config.credentialKey, email);
      setSession(reply, session, config.sessionKey, config.secureCookies === true);
      onSignIn(true);
      return reply.redirect('/');
    });
    return;
  }

  const oidc = config.oidc;
  if (!oidc) {
    throw new Error('COSTFLOW_AUTH=oidc requires issuer, client id, client secret, redirect URI.');
  }
  const fetchFn = config.fetchFn ?? fetch;
  const discover = async (): Promise<OidcDiscovery> => {
    const response = await fetchFn(
      `${oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
    );
    if (!response.ok) throw new Error(`OIDC discovery failed (${response.status}).`);
    return (await response.json()) as OidcDiscovery;
  };

  app.get('/login', async (_request, reply) => {
    const discovery = await discover();
    const state = newId();
    reply.setCookie('cf_oidc_state', signValue({ state }, config.sessionKey), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies === true,
    });
    const url =
      `${discovery.authorization_endpoint}?response_type=code` +
      `&client_id=${encodeURIComponent(oidc.clientId)}` +
      `&redirect_uri=${encodeURIComponent(oidc.redirectUri)}` +
      `&scope=${encodeURIComponent('openid email')}&state=${state}`;
    return reply.redirect(url);
  });

  app.get('/auth/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string };
    const stateCookie = verifyValue<{ state: string }>(
      request.cookies['cf_oidc_state'],
      config.sessionKey,
    );
    if (!query.code || !stateCookie || stateCookie.state !== query.state) {
      onSignIn(false);
      return reply.code(400).send('Invalid sign-in state.');
    }
    const discovery = await discover();
    const tokenResponse = await fetchFn(discovery.token_endpoint as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: query.code,
        redirect_uri: oidc.redirectUri,
        client_id: oidc.clientId,
        client_secret: oidc.clientSecret,
      }).toString(),
    });
    if (!tokenResponse.ok) {
      onSignIn(false);
      return reply.code(502).send('Sign-in failed at the identity provider.');
    }
    const tokens = (await tokenResponse.json()) as { access_token?: string };
    const userinfoResponse = await fetchFn(discovery.userinfo_endpoint as string, {
      headers: { Authorization: `Bearer ${tokens.access_token ?? ''}` },
    });
    if (!userinfoResponse.ok) {
      onSignIn(false);
      return reply.code(502).send('Sign-in failed at the identity provider.');
    }
    const userinfo = (await userinfoResponse.json()) as { email?: string };
    const email = (userinfo.email ?? '').trim().toLowerCase();
    if (!email) {
      onSignIn(false);
      return reply.code(502).send('Identity provider returned no email.');
    }
    const session = await signInByEmail(store, config.credentialKey, email);
    setSession(reply, session, config.sessionKey, config.secureCookies === true);
    onSignIn(true);
    return reply.redirect('/');
  });
}
