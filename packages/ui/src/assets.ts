import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The brand and social-sharing binaries, shared by both deployments.
 *
 * The application serves them from memory; the marketing build copies them into
 * its static output. Both read them from here so there is one logo, one favicon
 * and one Open Graph card — `/brand/logo.svg` in particular is a public URL
 * contract (the identity provider's Universal Login page renders it), so the
 * path and content type stay stable while the artwork inside can change.
 *
 * Reached through the `@costflow/ui/assets` subpath rather than the package
 * barrel, deliberately: this is the only module here that touches the file
 * system, and the marketing site's serverless function must not carry it.
 */
const ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url));

export type AssetName =
  | 'apple-touch-icon.png'
  | 'favicon.ico'
  | 'icon-192.png'
  | 'icon-512.png'
  | 'logo-dark.png'
  | 'logo-light.png'
  | 'og.jpg'
  | 'site.webmanifest';

export function readAsset(name: AssetName): Buffer {
  return readFileSync(ASSETS_DIR + name);
}

/**
 * The official icon wrapped as SVG, for `/brand/logo.svg`. The icon is
 * theme-neutral (no white), so it is safe on any background — including the
 * identity provider's login page, which is the reason this file exists.
 */
export function brandLogoSvg(): string {
  const png = readAsset('icon-192.png').toString('base64');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" role="img" aria-label="CostFlow"><image width="192" height="192" href="data:image/png;base64,${png}"/></svg>`;
}

/** Every asset served at a fixed public path, with the content type it needs. */
export const PUBLIC_ASSETS: ReadonlyArray<{
  readonly path: string;
  readonly name: AssetName;
  readonly type: string;
}> = [
  { path: '/apple-touch-icon.png', name: 'apple-touch-icon.png', type: 'image/png' },
  { path: '/brand/icon-192.png', name: 'icon-192.png', type: 'image/png' },
  { path: '/brand/icon-512.png', name: 'icon-512.png', type: 'image/png' },
  { path: '/brand/logo-dark.png', name: 'logo-dark.png', type: 'image/png' },
  { path: '/brand/logo-light.png', name: 'logo-light.png', type: 'image/png' },
  { path: '/favicon.ico', name: 'favicon.ico', type: 'image/x-icon' },
  { path: '/og.jpg', name: 'og.jpg', type: 'image/jpeg' },
  { path: '/site.webmanifest', name: 'site.webmanifest', type: 'application/manifest+json' },
];
