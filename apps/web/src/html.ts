/** Minimal server-rendered HTML shell (doc 09 P4.1 plan — no SPA build). */

export function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function layout(title: string, body: string): string {
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
</style>
</head>
<body>
<header><h1>CostFlow</h1><nav><a href="/">Home</a> · <a href="/runs">Runs</a></nav></header>
${body}
</body>
</html>`;
}

export const STEPS_NAV =
  '<p class="steps">Onboarding: connect → scope → statuses → roles → assumptions → run</p>';
