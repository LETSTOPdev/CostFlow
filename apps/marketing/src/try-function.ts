import type { IncomingMessage, ServerResponse } from 'node:http';
import { renderTryPage, renderTryReportPage } from './try-pages';
import { SECURITY_HEADERS } from './headers';

/**
 * The marketing site's only running code.
 *
 * It answers `/try` and `/try/report` and nothing else. Every other page on the
 * site is a file, so this is the entire attack surface and the entire cold-start
 * cost: no session, no cookies, no database, no secrets — a PRNG, the analysis
 * engine and the report renderer.
 *
 * `/try` is `no-store` because a cached "analyzing…" page would hand every
 * visitor the same company. `/try/report` is cacheable for half an hour keyed by
 * its seed, which is what makes a shared demo link cheap to open twice.
 */
export default function handler(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'https://fbx1.com');
  const isReport = url.pathname.replace(/\/$/, '') === '/try/report';
  const body = isReport
    ? renderTryReportPage(url.searchParams.get('seed') ?? undefined)
    : renderTryPage();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.setHeader(
    'cache-control',
    isReport ? 'public, max-age=1800, s-maxage=1800' : 'no-store',
  );
  response.statusCode = 200;
  response.end(body);
}
