/** Minimal server-rendered HTML shell (doc 09 P4.1 plan — no SPA build). */

export function esc(value: string): string {
  // Defense in depth: a mistyped non-string (e.g. a Date leaking from the DB
  // driver) must never crash the render layer with `replaceAll is not a
  // function` (P4.2 defect 2). The root cause is fixed at the store boundary;
  // this guarantees the page still renders even if one slips through.
  const s = typeof value === 'string' ? value : String(value ?? '');
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Page shell. When `csrf` is provided (authenticated pages), the shared
 * header carries a CSRF-protected sign-out form so logout is reachable from
 * every authenticated page. Public pages omit it (no session, no token).
 */
export function layout(title: string, body: string, csrf?: string): string {
  const signOut =
    csrf === undefined
      ? ''
      : ` · <form method="post" action="/logout" class="signout"><input type="hidden" name="csrf" value="${esc(
          csrf,
        )}"><button type="submit">Sign out</button></form>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — CostFlow</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #ddd; margin-bottom: 1.5rem; }
  h1 { font-size: 1.3rem; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 0.35rem 0.6rem; text-align: left; }
  label { display: block; margin: 0.5rem 0; }
  .error { color: #a40000; border: 1px solid #a40000; padding: 0.5rem; }
  .note { color: #555; font-size: 0.9rem; }
  .steps { color: #555; font-size: 0.85rem; margin-bottom: 1rem; }
  button { margin-top: 0.75rem; }
  nav { display: flex; gap: 0.5rem; align-items: baseline; }
  .signout { display: inline; margin: 0; }
  .signout button { margin: 0; background: none; border: none; color: #0645ad; cursor: pointer; padding: 0; font: inherit; text-decoration: underline; }
</style>
</head>
<body>
<header><h1>CostFlow</h1><nav><a href="/">Home</a> · <a href="/runs">Runs</a>${signOut}</nav></header>
${body}
</body>
</html>`;
}

export const STEPS_NAV =
  '<p class="steps">Onboarding: connect → scope → statuses → roles → assumptions → run</p>';
