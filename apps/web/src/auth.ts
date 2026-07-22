import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { encryptSecret, newId, newSalt, signValue, verifyValue } from './crypto';
import { esc } from './html';
import type { OrgRole, Store } from './store/contract';

/**
 * Authentication (doc 09 P4.1 plan §1). CostFlow never stores passwords.
 * Two adapters behind one session model:
 *  - 'oidc': authorization-code flow against any managed IdP (issuer
 *    discovery, code exchange, userinfo) — the production path;
 *  - 'dev': explicitly-gated email-only sign-in for local/test.
 * Both end in the same signed session cookie {userId, tenantId, csrf}.
 */

export const SESSION_COOKIE = 'cf_session';
/** Signed cookie carrying a pending invitation token through the sign-in hop. */
export const INVITE_COOKIE = 'cf_invite';

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
    /** Public, registered URL Auth0 returns to after SSO logout (validated in config). */
    readonly postLogoutRedirectUri: string;
  };
  /** Injected so tests can stub the IdP; defaults to global fetch. */
  readonly fetchFn?: typeof fetch;
}

/**
 * OIDC RP-initiated logout URL (P4.2 Gate 2). Terminating the local CostFlow
 * cookie is not enough: the IdP's tenant SSO session would silently
 * re-authenticate a protected route. This sends the browser to Auth0's
 * OIDC-compliant `/oidc/logout` (preferred over the legacy `/v2/logout`) to
 * end the SSO session, then return to the public post-logout page.
 *
 * We pass `client_id` + a registered `post_logout_redirect_uri` rather than
 * `id_token_hint`: the architecture does not retain the id_token (keeping it
 * out of the session cookie is the safer choice), and Auth0 accepts client_id
 * when the redirect URI is in the client's Allowed Logout URLs. No `federated`
 * param — we end only the Auth0 tenant session, never the upstream Google/
 * social account (that is deliberately more disruptive and out of scope).
 */
export function oidcLogoutUrl(oidc: {
  issuer: string;
  clientId: string;
  postLogoutRedirectUri: string;
}): string {
  const endpoint = `${oidc.issuer.replace(/\/$/, '')}/oidc/logout`;
  const params = new URLSearchParams({
    post_logout_redirect_uri: oidc.postLogoutRedirectUri,
    client_id: oidc.clientId,
  });
  return `${endpoint}?${params.toString()}`;
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

/**
 * Sign in, honoring a pending invitation token when present (P4.4). If the
 * token matches a PENDING invitation for THIS exact email, the invitee joins
 * the inviting organization with the invited role:
 *  - a brand-new email is provisioned into that org (no new org is created);
 *  - an email already in that same org just has its invite marked accepted.
 * A mismatched/expired token, or an email that already belongs to a DIFFERENT
 * organization, falls through to normal create-or-find-own-org sign-in and the
 * invitation stays pending — a user belongs to exactly one org in this model.
 */
export async function signInWithOptionalInvite(
  store: Store,
  credentialKey: Buffer,
  email: string,
  inviteToken: string | undefined,
): Promise<{ session: Session; acceptedRole: OrgRole | null }> {
  if (inviteToken) {
    const invitation = await store.getInvitationByToken(inviteToken);
    if (invitation && invitation.status === 'pending' && invitation.email === email) {
      const nowIso = new Date(Date.now()).toISOString();
      const existing = await store.findUserByEmail(email);
      if (!existing) {
        const user = await store.createUserInTenant(invitation.tenantId, email, invitation.role);
        await store.updateInvitationStatus(invitation.tenantId, invitation.id, 'accepted', nowIso);
        return {
          session: { userId: user.id, tenantId: user.tenantId, csrf: newId() },
          acceptedRole: invitation.role,
        };
      }
      if (existing.tenantId === invitation.tenantId) {
        await store.updateInvitationStatus(invitation.tenantId, invitation.id, 'accepted', nowIso);
        return {
          session: { userId: existing.id, tenantId: existing.tenantId, csrf: newId() },
          acceptedRole: existing.role,
        };
      }
      // Email already belongs to another org — cannot join a second. Fall
      // through; the invitation remains pending.
    }
  }
  const session = await signInByEmail(store, credentialKey, email);
  return { session, acceptedRole: null };
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
  log: (line: Record<string, unknown>) => void,
  onInviteAccepted?: (role: OrgRole) => void,
): void {
  // Cookies that must survive the cross-site redirect BACK from the identity
  // provider (the OIDC state nonce and a pending invite token) need
  // SameSite=None in production: a SameSite=Lax cookie is not reliably returned
  // on the IdP's cross-site callback (form_post, or after Chrome's
  // "Lax-allow-unsafe" 2-minute window during a slow interactive signup), which
  // manifested as "Invalid sign-in state" on real signups. None requires
  // Secure (production has it); dev over http keeps Lax.
  const crossSiteSameSite: 'none' | 'lax' = config.secureCookies === true ? 'none' : 'lax';
  const readInviteToken = (request: FastifyRequest): string | undefined =>
    verifyValue<{ token: string }>(request.cookies[INVITE_COOKIE], config.sessionKey)?.token;
  const clearInvite = (reply: FastifyReply): void => {
    reply.clearCookie(INVITE_COOKIE, {
      path: '/',
      httpOnly: true,
      sameSite: crossSiteSameSite,
      secure: config.secureCookies === true,
    });
  };
  const completeSignIn = async (
    request: FastifyRequest,
    reply: FastifyReply,
    email: string,
  ): Promise<void> => {
    const { session, acceptedRole } = await signInWithOptionalInvite(
      store,
      config.credentialKey,
      email,
      readInviteToken(request),
    );
    setSession(reply, session, config.sessionKey, config.secureCookies === true);
    clearInvite(reply);
    onSignIn(true);
    if (acceptedRole && onInviteAccepted) onInviteAccepted(acceptedRole);
  };

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
      await completeSignIn(request, reply, email);
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
      sameSite: crossSiteSameSite,
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
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };
    const stateCookie = verifyValue<{ state: string }>(
      request.cookies['cf_oidc_state'],
      config.sessionKey,
    );
    const codePresent = typeof query.code === 'string' && query.code.length > 0;
    const stateCookiePresent = stateCookie !== null;
    const stateMatch = stateCookie !== null && stateCookie.state === query.state;
    // Sanitized diagnostics: booleans + the OAuth error CODE only — never the
    // code, tokens, email, or the state value.
    log({
      level: 'info',
      msg: 'oidc-callback',
      code_present: codePresent,
      state_cookie_present: stateCookiePresent,
      state_match: stateMatch,
      error: typeof query.error === 'string' ? query.error : null,
    });
    // The IdP explicitly declined (e.g. access_denied for an unverified email):
    // surface that, not a misleading "invalid state".
    if (query.error) {
      onSignIn(false);
      return reply
        .code(400)
        .type('text/html')
        .send(
          `<!doctype html><title>Sign-in not completed — CostFlow</title><p>Sign-in was not completed (${esc(query.error)}). <a href="/login">Try again</a>.</p>`,
        );
    }
    if (!codePresent || !stateCookiePresent || !stateMatch) {
      onSignIn(false);
      return reply
        .code(400)
        .type('text/html')
        .send(
          `<!doctype html><title>Sign-in error — CostFlow</title><p>We couldn't complete sign-in — the sign-in link expired or was interrupted. <a href="/login">Start again</a>.</p>`,
        );
    }
    const discovery = await discover();
    const tokenResponse = await fetchFn(discovery.token_endpoint as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: query.code as string, // guaranteed present by the guard above
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
    await completeSignIn(request, reply, email);
    return reply.redirect('/');
  });
}
