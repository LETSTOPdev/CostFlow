/**
 * Two hostnames, one deployment.
 *
 * `https://fbx1.com` is the marketing site and `https://app.fbx1.com` is the
 * application. They are served by the same Fastify instance, routed on the Host
 * header, because the alternative — a second service — would duplicate the
 * design system, the shell and the deploy for no benefit at this size.
 *
 * The decision that makes this cheap: **authentication never leaves the app
 * host.** `/login`, `/signup`, `/auth/callback` and `/logged-out` are app paths,
 * the session cookie is host-only (no `Domain` attribute), and the identity
 * provider's registered callback and post-logout URLs are untouched by the
 * split. Nothing about auth is cross-origin, so nothing about auth changes.
 *
 * The split is OFF unless a marketing origin is configured. Unconfigured, every
 * link is relative and one host serves everything, which is what `pnpm preview`,
 * the CLI fixtures and every existing test rely on — and what production keeps
 * doing until `COSTFLOW_MARKETING_URL` is set.
 */

export interface Site {
  /** Absolute origin for links to marketing pages, or '' for same-origin. */
  readonly marketingOrigin: string;
  /** Absolute origin for links into the application, or '' for same-origin. */
  readonly appOrigin: string;
  /** Origin used in canonical, og:url and JSON-LD URLs on marketing pages. */
  readonly canonicalOrigin: string;
  /** True once both hosts are live and the router should redirect between them. */
  readonly split: boolean;
}

/**
 * One host serves everything and all links stay relative.
 *
 * `canonicalOrigin` is still absolute because a canonical URL has to be, and it
 * remains `app.fbx1.com` until the marketing site exists — pointing search
 * engines at a host that is not yet serving would be worse than the status quo.
 */
export const SAME_ORIGIN: Site = {
  marketingOrigin: '',
  appOrigin: '',
  canonicalOrigin: 'https://app.fbx1.com',
  split: false,
};

export function splitSite(marketingOrigin: string, appOrigin: string): Site {
  return {
    marketingOrigin,
    appOrigin,
    canonicalOrigin: marketingOrigin,
    split: true,
  };
}

/** A link to a marketing page. Relative until the marketing host exists. */
export const marketingUrl = (site: Site, path: string): string => `${site.marketingOrigin}${path}`;

/** A link into the application, including every authentication CTA. */
export const appUrl = (site: Site, path: string): string => `${site.appOrigin}${path}`;

/**
 * Paths that belong to the marketing site: everything a visitor sees before
 * authenticating. `/demo` and `/try` are here because they are sample reports
 * shown to prospects, rendered from a fixture with no store access.
 *
 * `/` is deliberately absent. It is the one path that legitimately exists on
 * both hosts — the landing on one, the sign-in screen on the other — and the
 * router treats it as a special case rather than redirecting it, which is also
 * what stops the two hosts from bouncing a visitor between them forever.
 */
const MARKETING_EXACT = new Set([
  '/about',
  '/accessibility',
  '/blog',
  '/careers',
  '/changelog',
  '/contact',
  '/cookies',
  '/demo',
  '/docs',
  '/dpa',
  '/faq',
  '/pricing',
  '/privacy',
  '/security',
  '/sitemap',
  '/sitemap.xml',
  '/terms',
  '/try',
]);

const MARKETING_PREFIXES = ['/try/'];

/**
 * Paths that answer identically on both hosts and must never redirect: static
 * brand assets referenced by both sites (and by the identity provider's login
 * page), the PWA manifest, and the health probes the platform calls by IP.
 */
const SHARED_PREFIXES = ['/brand/'];
const SHARED_EXACT = new Set([
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/healthz',
  '/og.jpg',
  '/readyz',
  '/robots.txt',
  '/site.webmanifest',
]);

export type PathOwner = 'marketing' | 'app' | 'shared' | 'root';

/** Which host owns a path. Query strings and trailing slashes are stripped. */
export function ownerOf(pathname: string): PathOwner {
  const path = pathname.split('?')[0]?.replace(/(.)\/$/, '$1') ?? '/';
  if (path === '/') return 'root';
  if (SHARED_EXACT.has(path)) return 'shared';
  if (SHARED_PREFIXES.some((p) => path.startsWith(p))) return 'shared';
  if (MARKETING_EXACT.has(path)) return 'marketing';
  if (MARKETING_PREFIXES.some((p) => path.startsWith(p))) return 'marketing';
  return 'app';
}

/** Every marketing path, for the sitemap and for the routing tests. */
export const MARKETING_PATHS: readonly string[] = [...MARKETING_EXACT].sort();
