/**
 * Two hostnames, two deployments.
 *
 * `https://fbx1.com` is the marketing site and `https://app.fbx1.com` is the
 * application. They are separate deployments on separate platforms — the
 * marketing site is prerendered and served from a CDN, the application runs as
 * a long-lived server next to its database — and they share this package so
 * there is exactly one design system, one report renderer and one brand.
 *
 * The decision that makes the split cheap: **authentication never leaves the
 * application host.** `/login`, `/signup`, `/auth/callback` and `/logged-out`
 * are application paths, the session cookie is host-only (no `Domain`
 * attribute), and the identity provider's registered callback and post-logout
 * URLs name `app.fbx1.com` alone. Nothing about auth is cross-origin, so
 * nothing about auth changes when the marketing site moves.
 *
 * Each host 301s away only the paths it does NOT own. That asymmetry is what
 * makes a redirect loop impossible: a redirect always moves a request toward
 * the host that will serve it, and that host has no rule sending it back. `/`
 * is the one path both own — the landing page on one, the way in on the other —
 * and neither redirects it.
 */

/** Where the marketing site lives. */
export const MARKETING_ORIGIN = 'https://fbx1.com';

/** Where the application lives, and the only origin that ever holds a session. */
export const APP_ORIGIN = 'https://app.fbx1.com';

export interface Site {
  /** Absolute origin for links to marketing pages, or '' for same-origin. */
  readonly marketingOrigin: string;
  /** Absolute origin for links into the application, or '' for same-origin. */
  readonly appOrigin: string;
  /** Origin used in canonical, og:url and JSON-LD URLs. Always the public site. */
  readonly canonicalOrigin: string;
}

/**
 * As seen from the application: marketing links are absolute (a different
 * deployment), application links stay relative (this one).
 *
 * A visitor clicking "Pricing" inside the app arrives at the marketing site
 * directly rather than through a redirect — a hop that can be cached, logged
 * or lost.
 */
export const APP_SITE: Site = {
  marketingOrigin: MARKETING_ORIGIN,
  appOrigin: '',
  canonicalOrigin: MARKETING_ORIGIN,
};

/** As seen from the marketing site: the mirror image. Every auth CTA is absolute. */
export const MARKETING_SITE: Site = {
  marketingOrigin: '',
  appOrigin: APP_ORIGIN,
  canonicalOrigin: MARKETING_ORIGIN,
};

/**
 * Point one side at a different origin — a preview deployment, a local pair of
 * ports. Production uses the constants above and needs no configuration, which
 * is deliberate: an origin that only one of the two deployments knows about is
 * an origin the two can disagree on.
 */
export function siteWith(base: Site, overrides: Partial<Site>): Site {
  return { ...base, ...overrides };
}

/** A link to a marketing page. Relative when the marketing site is rendering it. */
export const marketingUrl = (site: Site, path: string): string => `${site.marketingOrigin}${path}`;

/** A link into the application, including every authentication CTA. */
export const appUrl = (site: Site, path: string): string => `${site.appOrigin}${path}`;

/**
 * Paths that belong to the marketing site: everything a visitor sees before
 * authenticating. `/demo` and `/try` are here because they are sample reports
 * shown to prospects, rendered from a fixture with no store access.
 *
 * `/` is deliberately absent. It is the one path that legitimately exists on
 * both hosts — the landing on one, the sign-in screen on the other — and
 * neither host redirects it, which is also what stops the two from bouncing a
 * visitor between them forever.
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
 * page), the PWA manifest, `robots.txt` (present on both, with different
 * contents), and the health probes the platform calls by an internal name.
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

/**
 * The application paths the marketing site forwards rather than 404s.
 *
 * The marketing site cannot use `ownerOf`'s "anything else belongs to the app"
 * rule: it is the public entry point, so an unknown URL there is a genuine typo
 * and has to 404 like one. This is the explicit opposite list — every entrance
 * a bookmark, an old link or a shared report URL may still name.
 */
export const APP_PATH_PREFIXES: readonly string[] = [
  '/account',
  '/admin',
  '/assumptions',
  '/auth',
  '/connect',
  '/dashboard',
  '/invite',
  '/jobs',
  '/logged-out',
  '/login',
  '/logout',
  '/mapping',
  '/org',
  '/reports',
  '/runs',
  '/scope',
  '/settings',
  '/signup',
  '/workspaces',
];
