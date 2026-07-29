import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ORIGIN, APP_PATH_PREFIXES } from '@costflow/ui';
import { SECURITY_HEADERS } from './headers';
import handler from './try-function';

/**
 * Serve the built site locally, the way the CDN will.
 *
 * `pnpm --filter @costflow/marketing build && … serve` is how you look at the
 * marketing site before it ships. It implements the same four rules as the
 * generated `config.json` — files first, `/try` to the function, application
 * paths 301 out, everything else the branded 404 — so what you see here is what
 * the deployment does.
 */

const STATIC = fileURLToPath(new URL('../.vercel/output/static/', import.meta.url));
const PORT = Number(process.env['PORT'] ?? 4321);

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const fileFor = (pathname: string): string | null => {
  const clean = pathname.replace(/\/$/, '') || '/';
  for (const candidate of [
    clean === '/' ? 'index.html' : `${clean.slice(1)}.html`,
    clean.slice(1),
  ]) {
    const full = join(STATIC, candidate);
    if (candidate !== '' && existsSync(full) && !full.endsWith('/')) return full;
  }
  return null;
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/try' || path.replace(/\/$/, '') === '/try/report') {
    handler(request, response);
    return;
  }

  const appPath = APP_PATH_PREFIXES.find((p) => path === p || path.startsWith(`${p}/`));
  if (appPath !== undefined) {
    response.writeHead(301, { location: `${APP_ORIGIN}${request.url ?? path}` });
    response.end();
    return;
  }

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  const file = fileFor(path);
  if (!file) {
    const notFound = join(STATIC, '404.html');
    response.writeHead(404, { 'content-type': TYPES['.html'] as string });
    response.end(existsSync(notFound) ? readFileSync(notFound) : 'Not found');
    return;
  }
  const ext = file.slice(file.lastIndexOf('.'));
  response.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream' });
  response.end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => {
  console.error(`CostFlow marketing site on http://localhost:${PORT}`);
});
