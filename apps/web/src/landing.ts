import { layout } from './html';

/**
 * Public, unauthenticated pages for the free beta (v1): the marketing landing,
 * Terms, and Privacy. All self-contained HTML within the strict CSP (inline
 * styles only, no scripts, no external assets). The report demo lives in the
 * server route (it renders the structured report from a committed snapshot).
 */

export const SUPPORT_EMAIL = 'support@fbx1.com';

const hero = `
<section style="text-align:center; padding:2.5rem 0 1.5rem;">
  <p style="color:#137333; font-weight:600; letter-spacing:0.04em; text-transform:uppercase; font-size:0.8rem; margin:0;">Free public beta</p>
  <h1 style="font-size:2.1rem; line-height:1.15; margin:0.5rem auto; max-width:34rem;">See what workflow friction is costing your team.</h1>
  <p style="font-size:1.1rem; color:#444; max-width:34rem; margin:0.75rem auto 1.5rem;">
    Connect your Jira project and CostFlow turns delays, queues, and overdue work into an
    honest, itemized cost estimate — every number traceable to its formula and assumptions.
  </p>
  <p>
    <a href="/login" style="display:inline-block; background:#0645ad; color:#fff; padding:0.6rem 1.4rem; border-radius:6px; text-decoration:none; font-weight:600;">Get started free</a>
    &nbsp;
    <a href="/demo" style="display:inline-block; padding:0.6rem 1.2rem; text-decoration:none;">View a sample report →</a>
  </p>
  <p class="note">No credit card. Jira supported today. Your data is yours — export or delete it anytime.</p>
</section>`;

const how = `
<section>
  <h2>How it works</h2>
  <ol>
    <li><strong>Connect Jira</strong> — paste a read-only API token. CostFlow never writes back to your board.</li>
    <li><strong>Map &amp; confirm</strong> — match your statuses to stages and confirm the rates and effort assumptions. Nothing is priced on a guess you didn't approve.</li>
    <li><strong>Get your report</strong> — ranked frictions with cost ranges, confidence, and a full formula drill-down for every figure.</li>
  </ol>
</section>`;

const trust = `
<section>
  <h2>Built to be trusted, not to guess</h2>
  <ul>
    <li><strong>Every number is traceable.</strong> Each cost expands into its claim, formula, the exact work items, and the assumptions used — with their provenance.</li>
    <li><strong>Honest by construction.</strong> Unconfirmed assumptions stay <em>unpriced</em>; we tell you what to confirm rather than inventing a number.</li>
    <li><strong>People are never scored.</strong> Cost is attributed to processes and stages — never to named individuals. Identities are pseudonymized before analysis.</li>
    <li><strong>Your data, your control.</strong> Credentials are encrypted at rest; you can permanently delete a workspace or your whole organization at any time.</li>
  </ul>
</section>`;

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
  return `<section><h2>FAQ</h2>${items
    .map(
      ([q, a]) =>
        `<details><summary style="cursor:pointer; font-weight:600; margin:0.5rem 0;">${q}</summary><p class="note" style="margin-top:0;">${a}</p></details>`,
    )
    .join('')}</section>`;
}

const footer = `
<footer style="border-top:1px solid #ddd; margin-top:2rem; padding-top:1rem; color:#555; font-size:0.9rem;">
  <p>
    <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> ·
    <a href="/demo">Sample report</a> ·
    <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
  </p>
  <p>CostFlow — Business Friction Intelligence. Powered by FBX1.</p>
</footer>`;

/** Marketing landing shown to logged-out visitors at `/`. */
export function renderLanding(): string {
  const body = `${hero}${how}${trust}${faq()}
    <section style="text-align:center; margin-top:1.5rem;">
      <a href="/login" style="display:inline-block; background:#0645ad; color:#fff; padding:0.6rem 1.4rem; border-radius:6px; text-decoration:none; font-weight:600;">Get started free</a>
    </section>
    ${footer}`;
  return layout('CostFlow — see what friction costs your team', body);
}

export function renderTerms(): string {
  const body = `<h1>Terms of Service</h1>
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
    <p><a href="/">← Home</a> · <a href="/privacy">Privacy</a></p>`;
  return layout('Terms of Service — CostFlow', body);
}

export function renderPrivacy(): string {
  const body = `<h1>Privacy</h1>
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
    <p><a href="/">← Home</a> · <a href="/terms">Terms</a></p>`;
  return layout('Privacy — CostFlow', body);
}
