import { layout } from './html';

/**
 * Public, unauthenticated pages for the free beta (v1): the marketing landing,
 * Terms, and Privacy. All self-contained HTML within the strict CSP (inline
 * styles only, no scripts, no external assets) — the visual language comes from
 * the shared design system in html.ts. The report demo lives in the server
 * route (it renders the structured report from a committed snapshot).
 */

export const SUPPORT_EMAIL = 'support@fbx1.com';

/** Inline feature icons (currentColor, inherit the .ic gradient tint). */
const ICONS = {
  plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7V3M15 7V3M8 7h8v4a4 4 0 0 1-4 4 4 4 0 0 1-4-4V7ZM12 15v6"/></svg>',
  scale:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M7 7h10M5 7l-2.5 6a3 3 0 0 0 5 0L5 7ZM19 7l-2.5 6a3 3 0 0 0 5 0L19 7Z"/></svg>',
  report:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  trace:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 10 12 14 15 20 8"/><circle cx="10" cy="12" r="1.4"/><circle cx="14" cy="15" r="1.4"/></svg>',
  shield:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  people:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5.5M21 20a6 6 0 0 0-4-5.6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10" width="15" height="10" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
};

const hero = `
<section class="hero"><div class="container">
  <p class="eyebrow">✦ Free public beta</p>
  <h1>See what workflow friction is <span class="grad-text">costing your team</span>.</h1>
  <p class="lead">Connect your Jira project and CostFlow turns delays, queues, and overdue work into an
    honest, itemized cost estimate — every number traceable to its formula and assumptions.</p>
  <div class="hero-actions">
    <a class="btn btn-lg" href="/login">Get started free</a>
    <a class="btn btn-ghost btn-lg" href="/demo">View a sample report →</a>
  </div>
  <div class="trust-row">
    <span><span class="tick">✓</span> No credit card</span>
    <span><span class="tick">✓</span> Jira supported today</span>
    <span><span class="tick">✓</span> Read-only — never writes to your board</span>
    <span><span class="tick">✓</span> Export or delete anytime</span>
  </div>
</div></section>`;

const how = `
<section class="section"><div class="container">
  <div class="section-head">
    <p class="eyebrow">${ICONS.report} How it works</p>
    <h2>From board to boardroom in three steps</h2>
    <p class="lead">No spreadsheets, no consultants. A report your CFO would sign off on — in about a minute.</p>
  </div>
  <div class="grid grid-3">
    <div class="feature">
      <span class="step-num">1</span>
      <h3>Connect Jira</h3>
      <p>Paste a read-only API token. CostFlow reads your board and never writes back to it.</p>
    </div>
    <div class="feature">
      <span class="step-num">2</span>
      <h3>Map &amp; confirm</h3>
      <p>Match your statuses to stages and confirm the rates and effort assumptions. Nothing is priced on a guess you didn't approve.</p>
    </div>
    <div class="feature">
      <span class="step-num">3</span>
      <h3>Get your report</h3>
      <p>Ranked frictions with cost ranges, confidence tiers, and a full formula drill-down for every figure.</p>
    </div>
  </div>
</div></section>`;

const trust = `
<section class="section" style="background:var(--bg-2);border-block:1px solid var(--line)"><div class="container">
  <div class="section-head">
    <p class="eyebrow">${ICONS.shield} Built to be trusted</p>
    <h2>Intelligence you can defend, not just numbers you hope are right</h2>
  </div>
  <div class="grid grid-2">
    <div class="feature"><span class="ic">${ICONS.trace}</span>
      <h3>Every number is traceable</h3>
      <p>Each cost expands into its claim, formula, the exact work items, and the assumptions used — with their provenance.</p></div>
    <div class="feature"><span class="ic">${ICONS.scale}</span>
      <h3>Honest by construction</h3>
      <p>Unconfirmed assumptions stay <em>unpriced</em>. We tell you what to confirm rather than inventing a number.</p></div>
    <div class="feature"><span class="ic">${ICONS.people}</span>
      <h3>People are never scored</h3>
      <p>Cost is attributed to processes and stages — never to named individuals. Identities are pseudonymized before analysis.</p></div>
    <div class="feature"><span class="ic">${ICONS.lock}</span>
      <h3>Your data, your control</h3>
      <p>Credentials are encrypted at rest; you can permanently delete a workspace or your whole organization at any time.</p></div>
  </div>
</div></section>`;

function faq(): string {
  const items: [string, string][] = [
    [
      'Is it really free?',
      'Yes — CostFlow is a free public beta while we learn what teams need. Paid plans will come later; nothing you do now will cost you.',
    ],
    [
      'Which tools do you support?',
      'Jira today. Monday, Asana, and CSV import are proven in our engine and coming to the product soon.',
    ],
    [
      'Do you write to my Jira?',
      'Never. CostFlow reads only. We ask for a read-only API token and never modify your board.',
    ],
    [
      'How are the numbers calculated?',
      'From your imported work items and the rates and effort assumptions you confirm. Every figure drills down to its formula and inputs — open the sample report to see exactly how.',
    ],
    [
      'What about privacy and my data?',
      `Credentials are encrypted; individual identities are pseudonymized before analysis; you can export or permanently delete everything. See our <a href="/privacy">Privacy</a> page, or email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.`,
    ],
  ];
  return `<section class="section"><div class="container">
    <div class="section-head"><h2>FAQ</h2></div>
    <div class="faq-list">${items
      .map(([q, a]) => `<details><summary>${q}</summary><p class="note">${a}</p></details>`)
      .join('')}</div>
  </div></section>`;
}

const ctaBand = `
<section class="section"><div class="container">
  <div class="cta-band">
    <p class="eyebrow" style="background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.3);color:#fff">Free public beta</p>
    <h2>See your team's friction, priced.</h2>
    <p class="lead">Connect your Jira in about a minute and get an executive-ready report — free.</p>
    <div class="hero-actions"><a class="btn btn-lg" href="/login">Get started free</a></div>
  </div>
</div></section>`;

const footer = `
<footer class="site-footer"><div class="container">
  <p><a href="/terms">Terms</a> &nbsp;·&nbsp; <a href="/privacy">Privacy</a> &nbsp;·&nbsp;
    <a href="/demo">Sample report</a> &nbsp;·&nbsp;
    <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
  <p class="note">CostFlow — Business Friction Intelligence. Powered by FBX1.</p>
</div></footer>`;

/** Marketing landing shown to logged-out visitors at `/`. */
export function renderLanding(): string {
  const body = `${hero}${how}${trust}${faq()}${ctaBand}${footer}`;
  return layout('CostFlow — see what friction costs your team', body, undefined, { bleed: true });
}

/** Shared shell for the legal/long-form pages (Terms, Privacy). */
function legalPage(title: string, inner: string): string {
  const body = `<article class="panel" style="max-width:46rem;margin-inline:auto">${inner}</article>`;
  return layout(`${title} — CostFlow`, body);
}

export function renderTerms(): string {
  return legalPage(
    'Terms of Service',
    `<h1>Terms of Service</h1>
    <p class="note">Free public beta. Last updated 2026-07-22.</p>
    <p>CostFlow is provided as a free beta service, "as is" and without warranties. By using it you
    agree to the following. This is a plain-language beta agreement; a fuller agreement will accompany
    paid plans.</p>
    <h2>Your account and data</h2>
    <ul>
      <li>You may connect only work-tracking data you are authorized to access.</li>
      <li>You retain ownership of your data. You can export or permanently delete it at any time.</li>
      <li>CostFlow reads from connected providers only; it never writes back to them.</li>
    </ul>
    <h2>Acceptable use</h2>
    <ul>
      <li>Do not attempt to disrupt the service, access other organizations' data, or reverse the
      pseudonymization of individuals.</li>
      <li>The service may change or pause during beta; estimates are decision-support, not financial or
      legal advice.</li>
    </ul>
    <h2>Liability</h2>
    <p>To the maximum extent permitted by law, CostFlow is not liable for decisions made using its
    estimates. The beta is provided without warranty of accuracy or availability.</p>
    <h2>Contact</h2>
    <p>Questions: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
    <p class="note">This beta agreement is intended to be clear and fair; it is not a substitute for
    legal advice and will be reviewed by counsel before general availability.</p>
    <p style="margin-top:1.5rem"><a href="/">← Home</a> &nbsp;·&nbsp; <a href="/privacy">Privacy</a></p>`,
  );
}

export function renderPrivacy(): string {
  return legalPage(
    'Privacy',
    `<h1>Privacy</h1>
    <p class="note">Free public beta. Last updated 2026-07-22.</p>
    <p>CostFlow is designed to be privacy-preserving by construction.</p>
    <h2>What we process</h2>
    <ul>
      <li><strong>Your account:</strong> the email from your identity provider (used to sign you in).</li>
      <li><strong>Provider data:</strong> the work items you import, used only to produce your reports.</li>
      <li><strong>Credentials:</strong> your provider API token, <em>encrypted at rest</em> and used only to
      read your data.</li>
    </ul>
    <h2>How we protect it</h2>
    <ul>
      <li><strong>Individuals are pseudonymized</strong> before analysis; no report, export, or API response
      ranks or scores a named person.</li>
      <li><strong>Isolation:</strong> every organization's data is strictly scoped to that organization.</li>
      <li><strong>Operational logs</strong> record request shape only — never your data, credentials, or
      identities.</li>
      <li><strong>Product analytics</strong> during beta are aggregate counts only (how many organizations
      reach each step) — never your content.</li>
    </ul>
    <h2>Your rights</h2>
    <ul>
      <li>Delete a workspace, or your entire organization, at any time — deletion cascades to every
      derived report (GDPR-style erasure).</li>
      <li>Request help or a data question anytime: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</li>
    </ul>
    <p class="note">This notice is written to be honest and complete for the beta; it will be reviewed by
    counsel before general availability.</p>
    <p style="margin-top:1.5rem"><a href="/">← Home</a> &nbsp;·&nbsp; <a href="/terms">Terms</a></p>`,
  );
}
