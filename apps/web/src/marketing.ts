import { SUPPORT_EMAIL, layout } from './html';

/**
 * The marketing/trust/company pages beyond the landing, Terms, and Privacy:
 * Pricing, Security, About, Contact, Changelog, Blog, Careers, Docs, Cookies,
 * Subprocessors, Accessibility, Sitemap, and a standalone FAQ. Same shell as
 * every other public page (`layout()` — notch header, four-column footer, no
 * client JS). Copy is sourced verbatim from the doc audit; nothing here
 * invents a fact about CostFlow's history, team, or certifications.
 */

const CANON = 'https://app.fbx1.com';
const MAIL = `mailto:${SUPPORT_EMAIL}`;

/** Centered eyebrow/h1/lead header used at the top of every page in this file. */
function pageHead(eyebrow: string, h1: string, lead: string): string {
  return `<div class="section-head">
    <span class="eyebrow">${eyebrow}</span>
    <h1>${h1}</h1>
    <p class="lead">${lead}</p>
  </div>`;
}

/** Prose container (matches the Terms/Privacy `.panel` width) for long-form pages. */
function prose(inner: string): string {
  return `<article class="panel" style="max-width:46rem;margin-inline:auto;margin-top:2rem">${inner}</article>`;
}

function page(title: string, description: string, path: string, body: string): string {
  return layout(title, body, undefined, {
    canonical: `${CANON}${path}`,
    description,
  });
}

/* ------------------------------------------------------------------ *
 * 1. Pricing
 * ------------------------------------------------------------------ */

type Tier = {
  name: string;
  price: string;
  blurb: string;
  bullets: string[];
  cta: { label: string; href: string };
  featured?: boolean;
};

const TIERS: Tier[] = [
  {
    name: 'Limited',
    price: '$0 / month',
    blurb: "For seeing if this is worth it before you commit anyone else's time.",
    bullets: [
      '1 workspace, 1 connected tracker (Jira or ClickUp)',
      'Up to 3 team members',
      'Up to 3 analysis runs per month',
      '30-day report history',
      'Formula drill-down on every number',
      'Email support',
    ],
    cta: { label: 'Get started free', href: '/signup' },
  },
  {
    name: 'Pro',
    price: '$20 / user / month',
    blurb: 'For teams that want this running every week, not just once to see the number.',
    bullets: [
      'Everything in Limited, plus:',
      'Unlimited analysis runs',
      'Unlimited report history',
      'Unlimited team members (billed per active seat)',
      'CSV and raw JSON export on every report',
      'Multiple workspaces per organization',
      'Priority email support',
    ],
    cta: { label: 'Start with Pro', href: '/signup' },
    featured: true,
  },
  {
    name: 'Enterprise',
    price: '$100 / user / month',
    blurb:
      'For teams whose security review is the thing standing between "interested" and "connected."',
    bullets: [
      'Everything in Pro, plus:',
      'SSO / SAML sign-in for your whole org',
      'Audit logs across workspaces and members',
      'A signed Data Processing Agreement, not just a page about one',
      'Dedicated support contact and a real SLA',
      'Org-wide role and workspace management',
    ],
    cta: { label: 'Talk to us', href: MAIL },
  },
];

const PRICING_FAQ: [string, string][] = [
  [
    'Do I need a credit card for the Limited plan?',
    "No. It's free for as long as you want to stay on it.",
  ],
  [
    'Is Pro billed per seat or a flat rate?',
    'Per seat. $20 for every team member with an active login that month, not a flat per-workspace fee.',
  ],
  [
    'Can I start on Limited and upgrade later without losing anything?',
    'Yes. Your workspace, connections, and report history carry over. Upgrading just removes the caps.',
  ],
  [
    'What if we need to negotiate Enterprise pricing or terms?',
    `Email <a href="${MAIL}">${SUPPORT_EMAIL}</a>. $100/user/month is the list price; larger teams and longer commitments are exactly what that conversation is for.`,
  ],
];

export function renderPricing(): string {
  const cards = TIERS.map(
    (
      t,
    ) => `<div class="card card-hover"${t.featured ? ' style="border-color:color-mix(in srgb,var(--primary) 40%,var(--line));box-shadow:var(--sh-2)"' : ''}>
      <h3>${t.name}</h3>
      <p class="figure big" style="font-size:clamp(1.6rem,1.2rem + 1.5vw,2.1rem)">${t.price}</p>
      <p class="note" style="min-height:2.8em">${t.blurb}</p>
      <ul style="margin:1rem 0 1.4rem;padding-left:1.15rem;color:var(--ink-2);font-size:.92rem;display:flex;flex-direction:column;gap:.45rem">
        ${t.bullets.map((b) => `<li>${b}</li>`).join('')}
      </ul>
      <a class="btn btn-block${t.featured ? '' : ' btn-ghost'}" href="${t.cta.href}">${t.cta.label}</a>
    </div>`,
  ).join('');

  const faq = PRICING_FAQ.map(
    ([q, a]) => `<details><summary>${q}</summary><p class="note">${a}</p></details>`,
  ).join('');

  const body = `
    ${pageHead(
      'Pricing',
      'Simple, per-person pricing. Start free.',
      'One plan to see what CostFlow can do, one plan to run it for real, one plan for teams with a security review to get through first.',
    )}
    <p class="lead" style="text-align:center;max-width:38rem;margin:0 auto 2.4rem;font-size:1rem">
      No setup fees, no annual lock-in to get started, no sales call required for the first two plans.
      Every plan connects Jira or ClickUp the same way: read-only, encrypted, revocable whenever you want.
    </p>
    <div class="grid grid-3">${cards}</div>
    <div class="faq-list" style="margin-top:3rem">
      <h2 style="text-align:center;margin-bottom:1.2rem">Questions</h2>
      ${faq}
    </div>
    <div class="cta-band" style="margin-top:3rem">
      <h2>Ready to see what it's costing you?</h2>
      <a class="btn btn-lg" href="/signup">Get started free</a>
    </div>`;

  return page(
    'Pricing',
    'Start free. Pay per person once you need the whole team on it.',
    '/pricing',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 2. Security
 * ------------------------------------------------------------------ */

export function renderSecurity(): string {
  const body = `
    ${pageHead(
      'Security',
      "Built to be trusted with something you didn't have to give us.",
      "You're handing CostFlow an API token into your team's work-tracking system. Here's exactly what we do with it, and what we never do.",
    )}
    ${prose(`
      <h2>Read-only, always</h2>
      <p>CostFlow connects to Jira and ClickUp with a personal API token you provide, and it only reads.
      It doesn't write comments, change statuses, move tickets, or touch your board in any way. Revoke the
      token and the connection stops working immediately. That's the whole mechanism; there's no separate
      opt-out to remember.</p>

      <h2>Credentials, encrypted</h2>
      <p>Your API token is encrypted at rest. Nobody at CostFlow can read it back out in plain text once
      it's saved, including us. It's used exactly once per analysis run, to fetch your data, and then it's
      done.</p>

      <h2>People aren't the product</h2>
      <p>Every individual in your imported data is pseudonymized before analysis runs. No report, export, or
      dashboard ranks or scores a named person. Cost is attributed to processes and stages, queues, delays,
      overdue work, not to whoever happened to touch the ticket.</p>

      <h2>Your organization's data stays yours</h2>
      <p>Every organization's data is isolated from every other organization's. There's no cross-tenant
      reporting, no aggregate benchmarking that mixes your numbers with someone else's, and no way for
      another CostFlow customer to see anything about your workspace.</p>

      <h2>We don't track you to sell you anything</h2>
      <p>CostFlow ships with no third-party analytics, no ad trackers, no session replay tools. The strict
      content policy on every page blocks third-party scripts outright. It's not a settings toggle; it's how
      the app is built. What little product analytics we keep is aggregate counts, like how many
      organizations reach a given step, never your content.</p>

      <h2>Delete anytime, actually</h2>
      <p>You can delete a workspace or your entire organization whenever you want. Deletion cascades to
      every report derived from that data. We don't keep a "just in case" copy.</p>

      <h2>Where we're headed</h2>
      <p>CostFlow is a beta product from a small team. We haven't gone through a formal SOC 2 audit yet.
      We're building toward that as the product and the team grow, and we'll say so here the moment it's
      real rather than before. If your security team needs something specific to evaluate us, a data flow
      diagram, a subprocessor list, answers to a vendor questionnaire, email us and we'll get it to you
      directly.</p>
      <p class="note" style="margin-top:1.5rem"><a href="${MAIL}">Questions before you connect? ${SUPPORT_EMAIL}</a></p>
    `)}`;

  return page(
    'Security',
    'How CostFlow handles your workspace data, credentials, and individual privacy, in plain language.',
    '/security',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 3. About
 * ------------------------------------------------------------------ */

export function renderAbout(): string {
  const body = `
    ${pageHead(
      'About',
      "We build things that tell you what's actually happening.",
      'CostFlow is an FBX1 product. FBX1 builds small, focused tools for problems that most companies solve with a spreadsheet, a gut feeling, or nothing at all.',
    )}
    ${prose(`
      <p>A lot of software tells you what happened. Fewer tools tell you what it cost, in a way you can
      actually trace back to a number. That gap is where FBX1 starts: pick a problem people are already
      feeling, and build the smallest thing that answers it honestly.</p>
      <p>CostFlow is the first shape that took. Every team using Jira or ClickUp has delays, queues, and
      stalled work sitting in their board right now. Most of them have never seen a dollar figure attached
      to it, because nobody's built the thing that does that well. We did.</p>
      <p>We're not trying to be a platform, a suite, or a "system of record" for anything. We'd rather ship
      one thing that works than five things that sort of do. If CostFlow stops being useful to you, we want
      that to be obvious, not hidden behind a subscription you forgot to cancel.</p>

      <h2>What we're building toward</h2>
      <p>Right now that means Jira and ClickUp, priced friction, and a report you can hand to your team
      without arguing about the methodology. Next means more places that data lives, and more of the
      workflow that's currently invisible until someone finally asks: wait, how long has this been sitting
      here?</p>

      <h2>Talk to us</h2>
      <p>We're a small team building this in the open, during a free beta, because we'd rather build it
      with the people who'll actually use it than in a vacuum. If something's wrong, confusing, or missing,
      we want to hear about it. <a href="${MAIL}">${SUPPORT_EMAIL}</a> reaches actual humans, not a ticket
      queue.</p>
      <p style="margin-top:1.5rem"><a class="btn" href="/signup">See what it's costing your team</a></p>
    `)}`;

  return page(
    'About',
    'CostFlow is built by FBX1. We build focused software for problems that are usually left to guesswork.',
    '/about',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 4. Contact
 * ------------------------------------------------------------------ */

export function renderContact(): string {
  const body = `
    ${pageHead(
      'Contact',
      'Talk to us directly.',
      "CostFlow doesn't have a support ticket queue or a chatbot standing between you and an answer. Email us and a person reads it.",
    )}
    ${prose(`
      <h2>General questions, support, feedback</h2>
      <p><a href="${MAIL}">${SUPPORT_EMAIL}</a><br>
      We aim to reply within one business day. During beta, that's usually faster.</p>

      <h2>Evaluating CostFlow for your team?</h2>
      <p>Tell us your provider (Jira or ClickUp), roughly how many people are on the team, and what you're
      trying to figure out. That's enough for us to give you a real answer instead of a generic one.</p>

      <h2>Found a security issue?</h2>
      <p>Email the same address with "security" in the subject line. We'll prioritize it.</p>

      <h2>Press or partnerships?</h2>
      <p>Same address. We're small enough that there's no separate inbox for this yet. If that changes,
      this page will say so.</p>
      <p style="margin-top:1.5rem"><a class="btn" href="${MAIL}">${SUPPORT_EMAIL}</a></p>
    `)}`;

  return page(
    'Contact',
    'One real way to reach CostFlow: email. We read everything.',
    '/contact',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 5. Changelog
 * ------------------------------------------------------------------ */

export function renderChangelog(): string {
  const body = `
    ${pageHead(
      'Changelog',
      "What's new.",
      'A running log of what changed in CostFlow, newest first. No marketing spin, just what shipped.',
    )}
    ${prose(`
      <p>We're in beta, so this moves fast and sometimes backward. We ship things, learn they're wrong, and
      change them. If a change affects your reports or your data, we'll say so here, and for anything that
      actually matters, email you directly too.</p>
      <div class="empty">
        <h3>Nothing logged yet</h3>
        <p>Entries land here as real releases ship — no placeholder dates, no invented history.</p>
      </div>
      <p class="note">Entry format:</p>
      <pre style="white-space:pre-wrap;background:var(--bg-2);border:1px solid var(--line);border-radius:12px;padding:1rem 1.2rem;font-family:var(--mono);font-size:.85rem;color:var(--ink-2)"><code>### YYYY-MM-DD
[Added / Changed / Fixed] — one-line description in plain language.
Longer explanation if it needs one: what changed, why, and whether anyone needs to do anything about it.</code></pre>
    `)}`;

  return page('Changelog', "What's shipped, in the order it shipped.", '/changelog', body);
}

/* ------------------------------------------------------------------ *
 * 6. Blog
 * ------------------------------------------------------------------ */

const BLOG_TOPICS = [
  [
    'Why every friction number is a range, not a point estimate.',
    'The actual reasoning behind expected-value-with-a-range instead of a single confident-looking number.',
  ],
  [
    "What we mean by 'unpriced,' and why we'd rather show nothing than guess.",
    'The confidence-tier system and the decision to leave things unpriced instead of inventing an assumption.',
  ],
  [
    "The first version of CostFlow's cost model was wrong. Here's what changed.",
    "An honest post-mortem once there's something real to write about.",
  ],
  [
    'Reading a Jira board like a queueing problem.',
    "The mental model behind treating 'waiting' and 'stalled' as distinct, priceable states.",
  ],
] as const;

export function renderBlog(): string {
  const topics = BLOG_TOPICS.map(
    ([t, d]) => `<div class="feature is-static"><h3>${t}</h3><p>${d}</p></div>`,
  ).join('');

  const body = `
    ${pageHead(
      'Blog',
      'Notes from building CostFlow.',
      "Writing about the problem we're solving, how the pricing methodology actually works, and what we get wrong along the way.",
    )}
    ${prose(`
      <p>This is where the longer version of things lives: the reasoning behind a confidence tier, why we
      priced overdue work the way we did, what changed and why. If you want the short version, the product
      itself is the short version.</p>
    `)}
    <h2 style="text-align:center;margin:2.4rem 0 1.4rem">Planned, not yet written</h2>
    <div class="grid grid-2" style="max-width:44rem;margin-inline:auto">${topics}</div>
    <div class="empty" style="max-width:46rem;margin:2rem auto 0">
      <h3>Nothing published yet</h3>
      <p>Check back soon, or <a href="/">see the product</a> in the meantime.</p>
    </div>`;

  return page(
    'Blog',
    "Notes on workflow friction, pricing methodology, and what we're building.",
    '/blog',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 7. Careers
 * ------------------------------------------------------------------ */

export function renderCareers(): string {
  const body = `
    ${pageHead(
      'Careers',
      "Not hiring right now, but here's what matters to us when we are.",
      "CostFlow is a small team building a focused product during a free beta. There's nothing open at the moment.",
    )}
    ${prose(`
      <p>We'd rather tell you that plainly than leave a "Careers" link pointing at an empty page or a stale
      form. When we do open something up, we'll post it here first.</p>

      <h2>What we'd look for, when we're hiring</h2>
      <p>People who'd rather ship something small and correct than something big and impressive-sounding.
      People who read the actual formula behind a number before trusting it. People who are fine saying
      "I don't know" and then going and finding out.</p>

      <h2>In the meantime</h2>
      <p>If you're interested in what we're building and want to keep half an eye on this page, that's
      genuinely the best way to know first. We don't have a separate talent-network signup, and we're not
      going to build one just to collect emails.</p>
      <p class="note" style="margin-top:1.5rem">Questions anyway? <a href="${MAIL}">${SUPPORT_EMAIL}</a></p>
    `)}`;

  return page(
    'Careers',
    "Not actively hiring right now. Here's what we'd look for when that changes.",
    '/careers',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 8. Docs
 * ------------------------------------------------------------------ */

const DOCS_SECTIONS: [string, string][] = [
  [
    'Getting started',
    'Connecting Jira or ClickUp, choosing what to import, and running your first report: the same flow the product walks you through, written out in case you want to read ahead.',
  ],
  [
    'Connecting Jira',
    "Where to generate an API token, what scopes it needs, and what CostFlow does and doesn't do with it once it's connected.",
  ],
  [
    'Connecting ClickUp',
    "Same idea, ClickUp's version: token generation, list/space selection, and the read-only guarantee.",
  ],
  [
    'Mapping statuses and roles',
    "How your board's statuses map to CostFlow's six stage kinds (queue, active, review, blocked, done, abandoned) and what each one changes — queue and review are priced as waiting, done and abandoned are excluded. Plus how team members map to cost categories. Why this step exists: nothing gets priced on a mapping you didn't confirm yourself.",
  ],
  [
    'Understanding your report',
    'What a confidence tier (A/B/C) actually means, how a range and an expected value are calculated, and how to open any number all the way down to its formula and inputs.',
  ],
  [
    'Assumptions and rates',
    "Where hourly rates, time-allocation percentages, and cost-factor multipliers come from, which ones are vendor-suggested versus ones you've confirmed, and how to change them.",
  ],
  [
    'Exporting your data',
    "Every report can be exported as raw JSON or printed to PDF. What's in the export, and what it's useful for: audits, sharing outside CostFlow, your own analysis.",
  ],
  [
    'FAQ',
    'Short answers to the questions that come up most. See the standalone FAQ page for the full list.',
  ],
];

export function renderDocs(): string {
  const sections = DOCS_SECTIONS.map(
    ([h, p]) => `<div class="ws"><h4>${h}</h4><p class="note" style="margin:0">${p}</p></div>`,
  ).join('');

  const body = `
    ${pageHead(
      'Documentation',
      'Everything you need to run CostFlow, in one place.',
      "This isn't a developer API reference. CostFlow doesn't have a public API yet. It's the plain-language version of how the product actually works.",
    )}
    <div style="max-width:42rem;margin:2rem auto 0">${sections}</div>
    <p class="note" style="text-align:center;margin-top:1.5rem">Still stuck? <a href="${MAIL}">${SUPPORT_EMAIL}</a>. A real person answers.</p>`;

  return page(
    'Documentation',
    'How to connect your tracker, read your report, and understand the numbers.',
    '/docs',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 9. Cookies
 * ------------------------------------------------------------------ */

export function renderCookies(): string {
  const body = `
    ${pageHead(
      'Cookies',
      "We use exactly one kind of cookie, and it's not for ads.",
      "CostFlow sets a single session cookie so you stay logged in. That's the entire list.",
    )}
    ${prose(`
      <p>There's no analytics cookie, no advertising cookie, no third-party tracking pixel, and no
      cross-site tracking of any kind. The page you're on right now was built under a content policy that
      blocks third-party scripts outright, so there's nowhere for a tracker to run even if we wanted one.</p>

      <h2>The one cookie we do set</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Cookie</th><th>Purpose</th><th>Type</th><th>Expiry</th></tr></thead>
        <tbody><tr><td style="white-space:nowrap"><code>cf_session</code></td><td>Keeps you signed in between requests</td><td>Strictly necessary</td><td>Session / until logout</td></tr></tbody>
      </table></div>
      <p>Because this cookie is strictly necessary for the product to function, and it's not used for
      tracking, advertising, or analytics, CostFlow doesn't show a cookie-consent banner. There's nothing
      optional to consent to.</p>

      <h2>If that changes</h2>
      <p>If we ever add a cookie that isn't strictly necessary, this page, and a real consent banner, will
      exist before that cookie does, not after.</p>
      <p class="note" style="margin-top:1.5rem">Questions? <a href="${MAIL}">${SUPPORT_EMAIL}</a></p>
    `)}`;

  return page(
    'Cookie Policy',
    "CostFlow uses one cookie, and it's not for tracking you.",
    '/cookies',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 10. Data processing / Subprocessors
 * ------------------------------------------------------------------ */

export function renderSubprocessors(): string {
  const body = `
    ${pageHead(
      'Data processing',
      'Who else touches your data, and why.',
      "CostFlow is a small product with a short, honest list of infrastructure it depends on. Here's what's real today.",
    )}
    ${prose(`
      <h2>Identity and sign-in</h2>
      <p>Authentication runs through Auth0 (an Okta product) for single sign-on. Auth0 handles your login
      session; it doesn't see your Jira or ClickUp data.</p>

      <h2>Hosting and infrastructure</h2>
      <p>CostFlow's application and database run on Railway. Railway hosts the infrastructure; it doesn't
      have a separate relationship with your imported work-tracking data beyond storing it encrypted on our
      behalf.</p>

      <h2>What we don't have (yet)</h2>
      <p>No third-party analytics processor, no marketing/CRM platform connected to product data, no data
      broker relationships, no resale of any data to anyone, for any reason.</p>

      <h2>A note on completeness</h2>
      <p>This list reflects what's actually confirmed in CostFlow's architecture today. As the product
      grows, email delivery and error monitoring are the likely next additions, and this page will be
      updated before those services touch any customer data, not after. If your legal or security team
      needs a formal Data Processing Agreement ahead of a vendor review, email
      <a href="${MAIL}">${SUPPORT_EMAIL}</a> and we'll work through it directly.</p>
    `)}`;

  return page(
    'Subprocessors',
    'The infrastructure and services CostFlow relies on to run.',
    '/dpa',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 11. Accessibility
 * ------------------------------------------------------------------ */

export function renderAccessibility(): string {
  const body = `
    ${pageHead(
      'Accessibility',
      'Built to work with a keyboard, a screen reader, and normal eyesight, not just a mouse and 20/20 vision.',
      "CostFlow hasn't gone through a formal accessibility audit. Here's what's actually true about how it's built, and where to tell us when it isn't enough.",
    )}
    ${prose(`
      <p>Every interactive element is reachable by keyboard, in the order you'd expect visually. Every page
      has a skip-to-content link for anyone tabbing past the header on every single page load. Focus states
      are visible; you can see where you are without a mouse. Text and background colors are chosen for
      contrast, not just for looking right on one designer's monitor.</p>
      <p>We didn't add an accessibility overlay widget. Most of them cause more problems than they fix.
      We'd rather build the real thing into the product than paper over gaps with a script.</p>

      <h2>Where we're honest about the gap</h2>
      <p>We haven't run a full WCAG audit, and we're not going to claim a compliance level we haven't
      verified. If you use assistive technology and something in CostFlow doesn't work the way it should,
      that's exactly the feedback we need: not a hypothetical, an actual report from someone hitting the
      actual problem.</p>
      <p class="note" style="margin-top:1.5rem">Report an issue: <a href="${MAIL}">${SUPPORT_EMAIL}</a>.
      Tell us the page, what you were trying to do, and what happened instead. We'll get back to you and fix
      what we can.</p>
    `)}`;

  return page(
    'Accessibility',
    'How CostFlow approaches accessibility, and how to tell us where it falls short.',
    '/accessibility',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 12. Sitemap (human-readable)
 * ------------------------------------------------------------------ */

const SITEMAP_GROUPS: [string, [string, string][]][] = [
  [
    'Product',
    [
      ['/', 'Home: what CostFlow does and why'],
      ['/pricing', 'Pricing: free during beta'],
      ['/security', 'Security: how your data and credentials are handled'],
      ['/demo', 'Sample report: a real report, no signup'],
      ['/try', 'Try it live: a random generated company, run through the real engine'],
    ],
  ],
  [
    'Company',
    [
      ['/about', "About: who's building this"],
      ['/contact', 'Contact: one email address, real replies'],
      ['/careers', 'Careers: nothing open right now'],
      ['/blog', 'Blog: notes on the product and the problem'],
    ],
  ],
  [
    'Resources',
    [
      ['/docs', 'Documentation: how to connect, map, and read your report'],
      ['/changelog', 'Changelog: what shipped, in order'],
      ['/faq', 'FAQ: short answers to common questions'],
    ],
  ],
  [
    'Legal',
    [
      ['/terms', 'Terms of Service'],
      ['/privacy', 'Privacy'],
      ['/cookies', 'Cookie Policy'],
      ['/dpa', 'Subprocessors'],
      ['/accessibility', 'Accessibility'],
    ],
  ],
];

export function renderSitemap(): string {
  const groups = SITEMAP_GROUPS.map(
    ([heading, links]) => `<div class="ws" style="text-align:left">
      <h4>${heading}</h4>
      <ul style="margin:.5rem 0 0;padding-left:1.15rem;display:flex;flex-direction:column;gap:.5rem">
        ${links
          .map(([href, label]) => {
            const [name, ...rest] = label.split(': ');
            return `<li><a href="${href}">${name}</a>${rest.length ? `: ${rest.join(': ')}` : ''}</li>`;
          })
          .join('')}
      </ul>
    </div>`,
  ).join('');

  const body = `
    ${pageHead('Sitemap', 'Everything on this site.', 'Every page on CostFlow, in one list.')}
    <div class="grid grid-2" style="max-width:44rem;margin:1.5rem auto 0">${groups}</div>`;

  return page('Sitemap', 'Every page on CostFlow, in one list.', '/sitemap', body);
}

/* ------------------------------------------------------------------ *
 * 13. Standalone FAQ
 * ------------------------------------------------------------------ */

const FAQ_ALL: [string, string][] = [
  [
    'Is it really free? What&rsquo;s the catch?',
    'No catch. The Limited plan is free, permanently, not just for a trial window. No credit card to start. Upgrade to Pro or Enterprise only when the caps actually get in your way.',
  ],
  [
    'Will you change anything in my Jira or ClickUp?',
    'Never. CostFlow connects with a personal API token and only reads. No comments, no status changes, nothing written back.',
  ],
  [
    'How are the numbers calculated?',
    'From your imported work items and the rates you confirm. Every figure drills down to its formula and inputs. Open the sample report to see exactly how.',
  ],
  [
    'What about privacy and my data?',
    `Credentials are encrypted and individuals are pseudonymized before analysis. You can export or permanently delete everything at any time. See <a href="/privacy">Privacy</a> or email <a href="${MAIL}">${SUPPORT_EMAIL}</a>.`,
  ],
  [
    'Which tools do you support?',
    'Jira and ClickUp today. Monday, Asana, and CSV import are next.',
  ],
  [
    'Is there a public API?',
    'Not yet. You can export any report as raw JSON or a PDF right now. A documented API for pulling data programmatically is on the list, not built.',
  ],
  [
    'Do you sell or share my data with anyone?',
    `No. See <a href="/security">Security</a> and <a href="/dpa">Subprocessors</a> for exactly who touches infrastructure and what they do and don't see.`,
  ],
  [
    'What happens to my data if I stop using CostFlow?',
    'Delete your workspace or organization whenever you want, and it\'s actually gone. Deletion cascades to every report derived from it. We don\'t keep a backup "just in case."',
  ],
  [
    'I run a security review before letting any vendor near our Jira. Where do I start?',
    `<a href="/security">Security</a> and <a href="/dpa">Subprocessors</a> cover the substance. If you need something specific for a vendor questionnaire, email <a href="${MAIL}">${SUPPORT_EMAIL}</a> directly. We'll work through it with you rather than making you guess from a page.`,
  ],
];

export function renderFaq(): string {
  const items = FAQ_ALL.map(
    ([q, a]) => `<details><summary>${q}</summary><p class="note">${a}</p></details>`,
  ).join('');

  const body = `
    ${pageHead('FAQ', 'Questions people actually ask us.', 'Answers to the questions that come up most before and after connecting.')}
    <div class="faq-list" style="margin-top:1.5rem">${items}</div>`;

  return page(
    'FAQ',
    'Answers to the questions that come up most before and after connecting.',
    '/faq',
    body,
  );
}
