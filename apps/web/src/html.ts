/** Minimal server-rendered HTML shell (doc 09 P4.1 plan — no SPA build). */

import { HEADER_MARK } from './brand';

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
  // Public pages (no session) get a marketing header with a single "Sign in"
  // action; authenticated pages get the app nav + a CSRF-protected sign-out.
  const nav =
    csrf === undefined
      ? '<a href="/login">Sign in</a>'
      : `<a href="/">Home</a> · <a href="/runs">Runs</a> · <form method="post" action="/logout" class="signout"><input type="hidden" name="csrf" value="${esc(
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
  .danger { border: 1px solid #a40000; border-radius: 4px; padding: 0.75rem 1rem; margin: 1rem 0; }
  .danger h3 { margin-top: 0; color: #a40000; }
  .ws { border: 1px solid #ddd; border-radius: 4px; padding: 0.5rem 0.75rem; margin: 0.5rem 0; }
  .ws h4 { margin: 0 0 0.4rem; }
  form.inline { display: inline; margin: 0; }
  code { background: #f4f4f4; padding: 0.1rem 0.3rem; word-break: break-all; }
  .signout { display: inline; margin: 0; }
  .figure { font-size: 1.15rem; font-weight: 600; margin: 0.25rem 0; }
  .figure.big { font-size: 1.6rem; }
  .friction { border: 1px solid #e0e0e0; border-radius: 6px; padding: 0.6rem 1rem; margin: 0.75rem 0; }
  .friction h3 { margin: 0.2rem 0; font-size: 1.05rem; }
  details summary { cursor: pointer; color: #0645ad; margin: 0.4rem 0; }
  .tier { display: inline-block; font-size: 0.8rem; padding: 0.05rem 0.4rem; border-radius: 3px; border: 1px solid #999; }
  .tier-A { background: #e6f4ea; border-color: #34a853; }
  .tier-B { background: #fef7e0; border-color: #f9ab00; }
  .tier-C { background: #fce8e6; border-color: #ea4335; }
  .up { color: #a40000; font-weight: 600; }
  .down { color: #137333; font-weight: 600; }
  .signout button { margin: 0; background: none; border: none; color: #0645ad; cursor: pointer; padding: 0; font: inherit; text-decoration: underline; }
</style>
</head>
<body>
<header><h1 style="display:flex;align-items:center;"><a href="/" style="color:inherit;text-decoration:none;display:inline-flex;align-items:center;">${HEADER_MARK}CostFlow</a></h1><nav>${nav}</nav></header>
${body}
</body>
</html>`;
}

const ONBOARDING_STEPS = ['connect', 'scope', 'statuses', 'roles', 'assumptions', 'run'] as const;

/**
 * Onboarding progress line with the current step highlighted, so a first-time
 * user always knows where they are and what's left.
 */
export function stepsNav(current?: (typeof ONBOARDING_STEPS)[number]): string {
  const parts = ONBOARDING_STEPS.map((s) => (s === current ? `<strong>${s}</strong>` : s)).join(
    ' → ',
  );
  return `<p class="steps">Onboarding: ${parts}</p>`;
}

/** Back-compat default (no step highlighted). */
export const STEPS_NAV = stepsNav();

/**
 * Standalone print/export document (P5): no app chrome, print-optimized CSS,
 * drill-downs rendered expanded by the caller. The user prints to PDF from the
 * browser — no server-side PDF binary dependency.
 */
export function printLayout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — CostFlow</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 55rem; margin: 1.5rem auto; padding: 0 1rem; color: #111; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; border-bottom: 1px solid #ccc; padding-bottom: 0.2rem; }
  table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
  th, td { border: 1px solid #ccc; padding: 0.3rem 0.5rem; text-align: left; font-size: 0.85rem; }
  .figure { font-size: 1.15rem; font-weight: 600; } .figure.big { font-size: 1.6rem; }
  .friction { border: 1px solid #ddd; border-radius: 6px; padding: 0.5rem 0.9rem; margin: 0.6rem 0; break-inside: avoid; }
  .note { color: #555; font-size: 0.85rem; } .error { color: #a40000; }
  .tier { display: inline-block; font-size: 0.8rem; padding: 0.05rem 0.4rem; border-radius: 3px; border: 1px solid #999; }
  .up { color: #a40000; font-weight: 600; } .down { color: #137333; font-weight: 600; }
  code { background: #f4f4f4; padding: 0.1rem 0.3rem; }
  details > summary { display: none; }
  .appendix { margin-top: 1.5rem; font-size: 0.85rem; color: #333; border-top: 1px solid #ccc; padding-top: 0.75rem; }
  @media print { a[href]::after { content: ""; } .noprint { display: none; } }
</style>
</head>
<body>
<p class="noprint note">Use your browser's Print → Save as PDF to export this report.</p>
${body}
</body>
</html>`;
}

/** Fixed methodology appendix for the executive export (P5). */
export const METHODOLOGY_APPENDIX = `<section class="appendix">
  <h2>Methodology</h2>
  <p>Every figure is an estimate expressed as a range: <em>low – high (expected)</em>. Frictions are
  ranked by expected cost, computed deterministically from the imported work items and your stated
  assumptions — the same numbers are reproducible from the run's saved inputs.</p>
  <p><strong>Confidence tiers:</strong> A (fully observed data and customer-confirmed assumptions),
  B and C (progressively more inference or missing inputs — each drill-down states why).</p>
  <p><strong>Assumption provenance:</strong> vendor-suggested (unconfirmed — never priced in report
  mode), accepted by customer, customized by customer, or measured by customer.</p>
  <p><strong>Attribution:</strong> cost is attributed to processes, stages, and roles — never to
  named individuals. Individual identities are pseudonymized before analysis.</p>
</section>`;
