import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { APP_ORIGIN, APP_PATH_PREFIXES } from '@costflow/ui';
import { brandLogoSvg, PUBLIC_ASSETS, readAsset } from '@costflow/ui/assets';
import { SECURITY_HEADERS } from './headers';
import { PRERENDERED, notFoundPage, robotsTxt, sitemapXml } from './routes';

/**
 * Build the marketing site into Vercel's Build Output API v3 directory.
 *
 * Targeting the output format directly, rather than leaving a framework to
 * infer one, is what makes this deployment legible: every file the CDN will
 * serve and every route it will match is written here, in one pass, by code you
 * can read. There is no framework, no bundler config to reverse-engineer, and
 * nothing that behaves differently in production than it does locally.
 *
 *   .vercel/output/static/**            every page, as a file
 *   .vercel/output/functions/**       the two pages that run
 *   .vercel/output/config.json          headers, redirects, 404
 */

const OUT = fileURLToPath(new URL('../.vercel/output/', import.meta.url));
const STATIC = join(OUT, 'static');

function write(relativePath: string, body: string | Buffer): void {
  const full = join(STATIC, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** `/pricing` must serve `pricing.html` at that exact URL, with no redirect. */
const overrides: Record<string, { path: string; contentType: string }> = {};

function writePage(path: string, html: string): void {
  if (path === '/') {
    write('index.html', html);
    return;
  }
  const file = `${path.replace(/^\//, '')}.html`;
  write(file, html);
  overrides[file] = { path: path.replace(/^\//, ''), contentType: 'text/html; charset=utf-8' };
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(STATIC, { recursive: true });

  for (const page of PRERENDERED) writePage(page.path, page.render());
  // No override for the 404: it is reached by the error route, and giving it a
  // clean URL of its own would publish a second, indexable "page not found".
  write('404.html', notFoundPage());
  write('robots.txt', robotsTxt());
  write('sitemap.xml', sitemapXml());

  // The brand set, byte-identical to what the application serves, so a visitor
  // who moves between the two hosts never sees the logo change.
  for (const asset of PUBLIC_ASSETS) write(asset.path.replace(/^\//, ''), readAsset(asset.name));
  write('brand/logo.svg', brandLogoSvg());

  // The site's only running code, bundled here rather than left to the
  // platform's own bundler: the workspace ships TypeScript source rather than
  // built packages, and owning the bundle step is what stops that being the
  // platform's problem.
  //
  // The same bundle is written at BOTH paths so each URL is matched by the
  // filesystem directly. A single function plus a rewrite would be one file
  // fewer and one thing to get wrong: a rewritten request arrives with the
  // destination's path, so the handler would have lost the very fact it needs
  // — which of the two pages was asked for.
  const bundle = join(OUT, '.bundle.js');
  await esbuild({
    entryPoints: [fileURLToPath(new URL('./try-function.ts', import.meta.url))],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    minify: false,
  });
  const code = readFileSync(bundle);
  rmSync(bundle);
  for (const name of ['try.func', join('try', 'report.func')]) {
    const dir = join(OUT, 'functions', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.js'), code);
    writeFileSync(
      join(dir, '.vc-config.json'),
      JSON.stringify(
        {
          runtime: 'nodejs22.x',
          handler: 'index.js',
          launcherType: 'Nodejs',
          shouldAddHelpers: false,
          // Generating a company and pricing it takes well under a second; this
          // is a ceiling on a runaway, not a budget anything expects to use.
          maxDuration: 30,
        },
        null,
        2,
      ),
    );
  }

  /**
   * Application URLs that were once served here keep working.
   *
   * The public site cannot use the application's "anything unrecognised belongs
   * to the app" rule — it is the front door, so an unknown URL here is a typo
   * and must 404 like one. This is the explicit opposite list, and it is
   * one-directional: everything it names is a path the application owns and has
   * no rule sending back, so no redirect can loop.
   */
  const appPaths = APP_PATH_PREFIXES.map((p) => p.replace(/^\//, '')).join('|');

  const config = {
    version: 3,
    trailingSlash: false,
    routes: [
      // Hardening on every response, including static files and the 404.
      { src: '/(.*)', headers: SECURITY_HEADERS, continue: true },
      // The brand set is content-addressed by a `?v=` query in the markup, so a
      // day of browser caching is safe and a redeploy still purges the CDN.
      {
        src: '^/(brand/.*|favicon\\.ico|og\\.jpg|apple-touch-icon\\.png|site\\.webmanifest)$',
        headers: { 'cache-control': 'public, max-age=86400' },
        continue: true,
      },
      { src: `^/(${appPaths})(/.*)?$`, status: 301, headers: { Location: `${APP_ORIGIN}/$1$2` } },
      { handle: 'filesystem' },
      { handle: 'error' },
      { src: '/(.*)', status: 404, dest: '/404.html' },
    ],
    overrides,
  };
  writeFileSync(join(OUT, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);

  console.error(
    `Built ${PRERENDERED.length} pages + 404, ${PUBLIC_ASSETS.length + 1} assets and 2 functions into ${OUT}`,
  );
}

await main();
