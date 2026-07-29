import {
  CONFIDENCE_NOTE,
  MARKETING_SITE,
  ROLES_SKIP_COST,
  STAGE_KIND_GUIDE,
  STAGE_KIND_ORDER,
  SUPPORT_EMAIL,
  appUrl,
  layout,
  marketingUrl,
  type Site,
} from '@costflow/ui';

/**
 * The marketing/trust/company pages beyond the landing, Terms, and Privacy:
 * Pricing, Security, About, Contact, Changelog, Blog, Careers, Docs, Cookies,
 * Subprocessors, Accessibility, Sitemap, and a standalone FAQ. Same shell as
 * every other public page (`layout()` — notch header, four-column footer, no
 * client JS). Copy is sourced verbatim from the doc audit; nothing here
 * invents a fact about CostFlow's history, team, or certifications.
 */

const MAIL = `mailto:${SUPPORT_EMAIL}`;

/**
 * What a confidence letter means, taken from the same table the product renders
 * beside every figure rather than restated here.
 *
 * These were once written out by hand and drifted a full tier: the manual said
 * B meant "consistent with" while the report labelled C that way, so a customer
 * who read this page and then read their own report concluded their weakest
 * grade was their middle one. The vocabulary is `doc 07 §1.5` and it is not
 * ours to paraphrase. Importing it means a change to the tiers reaches the
 * documentation or fails to compile.
 */
const tier = (grade: 'A' | 'B' | 'C'): string => (CONFIDENCE_NOTE[grade] ?? '').toLowerCase();

/**
 * The canonical stage-kind guide writes each clause as a sentence, because the
 * onboarding step puts it in its own table cell. `/docs` continues a sentence
 * after an em dash, where a capital letter reads as a formatting mistake. The
 * words stay the canonical ones; only the first letter bends to the sentence
 * it is now inside.
 */
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

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

/**
 * Every page in this file takes the `Site` and passes it straight here, rather
 * than reading a module-level origin. It is more typing at 16 call sites and it
 * means the origins are an argument a test can vary, not process state a test
 * has to install and remember to remove.
 */
function page(site: Site, title: string, description: string, path: string, body: string): string {
  return layout(title, body, undefined, {
    canonical: `${site.canonicalOrigin}${path}`,
    description,
    site,
  });
}

/* ------------------------------------------------------------------ *
 * 1. Pricing
 * ------------------------------------------------------------------ */

/**
 * A bullet is either shipped, or explicitly marked as not built yet.
 *
 * The prices and tiers below are the intended commercial shape. The product is
 * in beta with no billing, so a page that presented all of it as available
 * would be selling four things that do not exist (export formats, SSO, a
 * customer-visible audit log, a second workspace) to a design partner who will
 * find out within an hour. Every other page on this site that is empty says it
 * is empty; this one has to hold the same line.
 */
type Bullet = string | { text: string; planned: true };

type Tier = {
  name: string;
  price: string;
  blurb: string;
  bullets: Bullet[];
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
      { text: 'CSV and raw JSON export on every report', planned: true },
      { text: 'Multiple workspaces per organization', planned: true },
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
      { text: 'SSO / SAML sign-in for your whole org', planned: true },
      { text: 'Audit logs across workspaces and members', planned: true },
      'A signed Data Processing Agreement, not just a page about one',
      'Dedicated support contact and a real SLA',
      'Org-wide role and workspace management',
    ],
    cta: { label: 'Talk to us', href: MAIL },
  },
];

const PRICING_FAQ: [string, string][] = [
  [
    'What does &ldquo;free during beta&rdquo; actually mean?',
    'There is no billing in the product yet, so nothing on this page can be charged for. Every account gets everything that is built, with no caps enforced, until we turn billing on. When we do, we will email you first and you will choose a plan then rather than find a charge.',
  ],
  [
    'Do I need a credit card for the Limited plan?',
    "No. It's free for as long as you want to stay on it.",
  ],
  [
    'Is Pro billed per seat or a flat rate?',
    'Per seat, once billing exists. $20 for every team member with an active login that month, not a flat per-workspace fee.',
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

export function renderPricing(site: Site = MARKETING_SITE): string {
  const cards = TIERS.map(
    (
      t,
    ) => `<div class="card card-hover"${t.featured ? ' style="border-color:color-mix(in srgb,var(--primary) 40%,var(--line));box-shadow:var(--sh-2)"' : ''}>
      <h3>${t.name}</h3>
      <p class="figure big" style="font-size:clamp(1.6rem,1.2rem + 1.5vw,2.1rem)">${t.price}</p>
      <p class="note" style="min-height:2.8em">${t.blurb}</p>
      <ul style="margin:1rem 0 1.4rem;padding-left:1.15rem;color:var(--ink-2);font-size:.92rem;display:flex;flex-direction:column;gap:.45rem">
        ${t.bullets
          .map((b) =>
            typeof b === 'string'
              ? `<li>${b}</li>`
              : `<li style="opacity:.72">${b.text} <span style="white-space:nowrap;font-size:.78rem;border:1px solid var(--line);border-radius:999px;padding:.05rem .45rem;margin-left:.2rem">planned</span></li>`,
          )
          .join('')}
      </ul>
      <a class="btn btn-block${t.featured ? '' : ' btn-ghost'}" href="${t.cta.href.startsWith('/') ? appUrl(site, t.cta.href) : t.cta.href}">${t.cta.label}</a>
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
    <p class="lead" style="text-align:center;max-width:38rem;margin:0 auto 1.4rem;font-size:1rem">
      No setup fees, no annual lock-in to get started, no sales call required for the first two plans.
      Every plan connects Jira or ClickUp the same way: read-only, encrypted, revocable whenever you want.
    </p>
    <div class="info" style="max-width:42rem;margin:0 auto 2.4rem">
      <strong>CostFlow is in beta, and billing is not built yet.</strong> Nothing on this page can be
      charged for today. Every account gets everything that exists, with none of these caps enforced,
      until we turn billing on and tell you first. The prices below are what we intend to charge, and
      anything marked <em>planned</em> is not built yet.
    </div>
    <div class="grid grid-3">${cards}</div>
    <div class="faq-list" style="margin-top:3rem">
      <h2 style="text-align:center;margin-bottom:1.2rem">Questions</h2>
      ${faq}
    </div>
    <div class="cta-band" style="margin-top:3rem">
      <h2>Ready to see what it's costing you?</h2>
      <a class="btn btn-lg" href="${appUrl(site, '/signup')}">Get started free</a>
    </div>`;

  return page(
    site,
    'Pricing',
    'Start free. Pay per person once you need the whole team on it.',
    '/pricing',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 2. Security
 * ------------------------------------------------------------------ */

export function renderSecurity(site: Site = MARKETING_SITE): string {
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
      <p>To be precise about what that does and doesn't mean: we do store assignee names as your tracker
      shows them, in your workspace configuration, because the setup flow asks you to map people to roles and
      you need to recognise who you're mapping. Those names are never an input to the analysis and never
      reach a report. A guard checks the rendered bytes of every report against the identities in your own
      data and withholds the report rather than serve one that names somebody.</p>

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
    site,
    'Security',
    'How CostFlow handles your workspace data, credentials, and individual privacy, in plain language.',
    '/security',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 3. About
 * ------------------------------------------------------------------ */

export function renderAbout(site: Site = MARKETING_SITE): string {
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
      <p style="margin-top:1.5rem"><a class="btn" href="${appUrl(site, '/signup')}">See what it's costing your team</a></p>
    `)}`;

  return page(
    site,
    'About',
    'CostFlow is built by FBX1. We build focused software for problems that are usually left to guesswork.',
    '/about',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 4. Contact
 * ------------------------------------------------------------------ */

export function renderContact(site: Site = MARKETING_SITE): string {
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
    site,
    'Contact',
    'One real way to reach CostFlow: email. We read everything.',
    '/contact',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 5. Changelog
 * ------------------------------------------------------------------ */

export function renderChangelog(site: Site = MARKETING_SITE): string {
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

  return page(site, 'Changelog', "What's shipped, in the order it shipped.", '/changelog', body);
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

export function renderBlog(site: Site = MARKETING_SITE): string {
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
    site,
    'Blog',
    "Notes on workflow friction, pricing methodology, and what we're building.",
    '/blog',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 7. Careers
 * ------------------------------------------------------------------ */

export function renderCareers(site: Site = MARKETING_SITE): string {
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
    site,
    'Careers',
    "Not actively hiring right now. Here's what we'd look for when that changes.",
    '/careers',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 8. Docs
 * ------------------------------------------------------------------ */

/**
 * The documentation, not a table of contents for documentation that does not
 * exist. This page previously listed eight section titles with a sentence
 * describing what each one would say, which reads as a promise everywhere else
 * on this site is careful not to make — /careers says it is not hiring,
 * /changelog says nothing has shipped, /blog says the posts are unwritten.
 *
 * Everything below is answerable from the product itself, so it is written out
 * rather than linked to pages that would immediately go stale.
 */
const DOCS_SECTIONS: [string, string][] = [
  [
    'Getting started',
    `<p>Six steps, once, and about a minute of typing if your board is small. Nothing is written back to your tracker at any point.</p>
     <ol>
       <li><strong>Connect</strong> Jira or ClickUp with a read-only API token.</li>
       <li><strong>Scope</strong>: pick the Lists or projects to analyse. Picking a container (a ClickUp Space or Folder) includes everything inside it, now and later.</li>
       <li><strong>Statuses</strong>: confirm which of the six stage kinds each of your statuses is. We pre-fill a suggestion from your board.</li>
       <li><strong>Roles</strong>: optional. Map people to roles so their work is priced at a role rate rather than the default.</li>
       <li><strong>Assumptions</strong>: accept or change the rates and thresholds. Nothing is priced on a value you did not confirm.</li>
       <li><strong>Run</strong>: read-only, and re-runnable whenever you want.</li>
     </ol>
     <p>Every step is changeable afterwards from Settings, and re-running is free and non-destructive: past reports stay exactly as they were.</p>`,
  ],
  [
    'Connecting Jira',
    `<p>You need three things: your site URL (<code>https://your-org.atlassian.net</code>), the email you sign in to Atlassian with, and an API token from
      <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">id.atlassian.com &rarr; API tokens</a>.
      Create one, name it "CostFlow", and paste it in.</p>
     <p>The token inherits your own Jira permissions, so CostFlow sees exactly the projects you see and nothing else. It is used only to read issues, statuses, assignees and changelog history. It is encrypted at rest and never displayed again after you save it. Revoke it in Atlassian and the connection stops working immediately.</p>`,
  ],
  [
    'Connecting ClickUp',
    `<p>In ClickUp: avatar &rarr; <strong>Settings</strong> &rarr; <strong>ClickUp API</strong> under Integrations &amp; ClickApps &rarr; <strong>Copy</strong>. The token starts with <code>pk_</code>. Only use <em>Regenerate</em> if you have no token yet, because regenerating breaks any other tool already using it.</p>
     <p><strong>One thing to check before you run.</strong> Time spent waiting in a status is the largest cost CostFlow usually finds, and on ClickUp it exists only if a Workspace admin has enabled the <strong>Total Time in Status</strong> ClickApp. Without it CostFlow still prices overdue and stale work, and it will tell you in the report that wait analysis was skipped and why. Turning the ClickApp on and re-running fills it in.</p>`,
  ],
  [
    'Mapping statuses and roles',
    `<p>Your status names stay exactly as they are. The stage kind tells CostFlow how to treat the time spent in that status, and it decides whether time counts as work or as waiting.</p>
     <ul>
       ${STAGE_KIND_ORDER.map(
         (kind) =>
           `<li><strong>${kind}</strong> &mdash; ${lowerFirst(STAGE_KIND_GUIDE[kind].use)} ${STAGE_KIND_GUIDE[kind].changes}</li>`,
       ).join('')}
     </ul>
     <p>${ROLES_SKIP_COST}</p>`,
  ],
  [
    'Understanding your report',
    `<p>A <strong>friction</strong> is a measurable place where your process loses money without anyone deciding to spend it: work sitting in a queue, items aging past your own threshold, commitments already past their due date. It is not a person, a project or a ticket. It is a stage, in one of your Lists or projects, with a magnitude CostFlow observed in your own data.</p>
     <p>The report is ordered for a two-minute read. The top names <strong>one place to start</strong> and the cost at stake there. Below a labelled divider is the working: every priced friction ranked by cost, what changed since last time, what could not be priced, and how much of your data the analysis could actually see.</p>
     <p>Every figure is a <strong>range</strong> with an expected value, never a single confident-looking number, because the inputs do not support that precision. Open <em>How this number was computed</em> on any friction to see the formula, every contributing work item, and each assumption with where it came from.</p>
     <p><strong>Confidence</strong> caps how much of the figure was observed rather than inferred. <strong>A</strong> means ${tier('A')}: the figure rests on your own event history. <strong>B</strong> means ${tier('B')}, usually because a duration was inferred from snapshot dates rather than read from transitions. <strong>C</strong> means ${tier('C')}, most often because a default rate was applied to people who were not mapped to roles. A finding never outranks one of a higher grade, however large it is.</p>`,
  ],
  [
    'Assumptions and rates',
    `<p>Two kinds of value go into every price: rates (what an hour costs) and parameters (your aging threshold, and how much attention a waiting item consumes per day). CostFlow suggests a starting value for each one.</p>
     <p><strong>A suggestion is never used to price anything.</strong> Until you accept a value or replace it with your own, it stays vendor-suggested and every friction that depends on it is reported as measured but <em>unpriced</em>, with the assumption it is waiting on named. That is deliberate: a number you did not agree to is a number you cannot defend in a meeting.</p>
     <p>You can enter pay as an hourly rate or as a monthly salary, in which case CostFlow divides it into an hourly rate by exact decimal arithmetic and shows you the result. Change any assumption in Settings and re-run; old reports keep the assumptions they were computed with.</p>`,
  ],
  [
    'When CostFlow refuses to answer',
    `<p>Some of what the product does is decline, and it says which kind of refusal you are reading.</p>
     <ul>
       <li><strong>Unpriced frictions.</strong> Found and measured, but resting on an assumption you have not confirmed. The fix is one click on the assumptions step.</li>
       <li><strong>A skipped detector.</strong> Your data cannot support it, for example wait analysis without status history. The report says which capability is missing and, where you can fix it, how.</li>
       <li><strong>No trend.</strong> Run-over-run comparison is withheld when the two runs are not measuring the same thing: the scope changed, an assumption changed, or a detector that used to skip now runs. A total moving for those reasons is not your team improving, so no arrow is drawn.</li>
       <li><strong>No recommendation.</strong> A recommendation needs friction that concentrates somewhere specific, with enough items behind it to call the pattern systemic. Where nothing meets that bar, CostFlow names the largest measured cost instead of recommending an intervention, and says which of the two you are reading. A large board can still fall short of it: the bar is about concentration, not size.</li>
     </ul>
     <p>A refusal is never presented as a clean result. If nothing could be priced, the report says so and tells you what is blocking it.</p>`,
  ],
  [
    'Exporting your data, and deleting it',
    `<p>Today every report has a <strong>printable version</strong> (use your browser's Print &rarr; Save as PDF) and a <strong>full itemized view</strong> containing every contributing work item and its arithmetic, including the rows the on-screen report truncates for length.</p>
     <p>Machine-readable export &mdash; JSON and CSV &mdash; and a documented API are planned and not built. If you need the underlying data for an audit before then, email us and we will get it to you.</p>
     <p>Deleting a workspace or your organization removes it and every report derived from it, in one transaction, with no retained copy.</p>`,
  ],
];

export function renderDocs(site: Site = MARKETING_SITE): string {
  const sections = DOCS_SECTIONS.map(
    ([h, p]) =>
      `<section class="ws" style="margin-bottom:1.1rem"><h3 style="margin-top:0">${h}</h3><div class="note" style="margin:0">${p}</div></section>`,
  ).join('');

  const body = `
    ${pageHead(
      'Documentation',
      'How CostFlow works, in plain language.',
      "Not a developer API reference: CostFlow doesn't have a public API yet. This is what the product does, what it refuses to do, and why.",
    )}
    <div style="max-width:44rem;margin:2rem auto 0">${sections}</div>
    <p class="note" style="text-align:center;margin-top:1.5rem">Not covered here? <a href="${MAIL}">${SUPPORT_EMAIL}</a>. A real person answers.</p>`;

  return page(
    site,
    'Documentation',
    'How to connect your tracker, read your report, and understand the numbers.',
    '/docs',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 9. Cookies
 * ------------------------------------------------------------------ */

export function renderCookies(site: Site = MARKETING_SITE): string {
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
    site,
    'Cookie Policy',
    "CostFlow uses one cookie, and it's not for tracking you.",
    '/cookies',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 10. Data processing / Subprocessors
 * ------------------------------------------------------------------ */

export function renderSubprocessors(site: Site = MARKETING_SITE): string {
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
    site,
    'Subprocessors',
    'The infrastructure and services CostFlow relies on to run.',
    '/dpa',
    body,
  );
}

/* ------------------------------------------------------------------ *
 * 11. Accessibility
 * ------------------------------------------------------------------ */

export function renderAccessibility(site: Site = MARKETING_SITE): string {
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
    site,
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

export function renderSitemap(site: Site = MARKETING_SITE): string {
  const groups = SITEMAP_GROUPS.map(
    ([heading, links]) => `<div class="ws" style="text-align:left">
      <h4>${heading}</h4>
      <ul style="margin:.5rem 0 0;padding-left:1.15rem;display:flex;flex-direction:column;gap:.5rem">
        ${links
          .map(([href, label]) => {
            const [name, ...rest] = label.split(': ');
            return `<li><a href="${marketingUrl(site, href)}">${name}</a>${rest.length ? `: ${rest.join(': ')}` : ''}</li>`;
          })
          .join('')}
      </ul>
    </div>`,
  ).join('');

  const body = `
    ${pageHead('Sitemap', 'Everything on this site.', 'Every page on CostFlow, in one list.')}
    <div class="grid grid-2" style="max-width:44rem;margin:1.5rem auto 0">${groups}</div>`;

  return page(site, 'Sitemap', 'Every page on CostFlow, in one list.', '/sitemap', body);
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
    'Not yet. Every report has a printable version you can save as a PDF, and a full itemized view with every contributing work item and its arithmetic. Machine-readable export (JSON, CSV) and a documented API are on the list, not built.',
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

export function renderFaq(site: Site = MARKETING_SITE): string {
  const items = FAQ_ALL.map(
    ([q, a]) => `<details><summary>${q}</summary><p class="note">${a}</p></details>`,
  ).join('');

  const body = `
    ${pageHead('FAQ', 'Questions people actually ask us.', 'Answers to the questions that come up most before and after connecting.')}
    <div class="faq-list" style="margin-top:1.5rem">${items}</div>`;

  return page(
    site,
    'FAQ',
    'Answers to the questions that come up most before and after connecting.',
    '/faq',
    body,
  );
}
