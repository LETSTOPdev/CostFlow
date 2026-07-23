import { HEADER_MARK } from './brand';
import { layout } from './html';

/**
 * Public, unauthenticated pages for the free beta (v1): the marketing landing,
 * Terms, and Privacy. All self-contained HTML within the strict CSP (inline
 * styles only, no scripts, no external assets). The landing is product-led: a
 * large app-window mockup built from the real CostFlow report UI, ambient glow,
 * layered glass cards, and CSS-only motion. Landing-specific styling is scoped
 * to a `<style>` block in the body so the app pages stay lean.
 */

export const SUPPORT_EMAIL = 'support@fbx1.com';

/* ------------------------------------------------------------------ *
 * The product mockup — a faux CostFlow app window rendered from the
 * real report UI (dark app theme), used as the hero centerpiece.
 * ------------------------------------------------------------------ */

const frictionRow = (
  rank: number,
  title: string,
  amount: string,
  tier: 'A' | 'B' | 'C',
  width: number,
): string => `
  <div class="lp-fr">
    <div class="lp-fr-head">
      <span class="lp-fr-rank">#${rank}</span>
      <span class="lp-fr-title">${title}</span>
      <span class="lp-pill lp-pill-${tier}">● ${tier}</span>
    </div>
    <div class="lp-fr-foot">
      <span class="lp-fr-amt">${amount}</span>
      <span class="lp-bar"><i style="width:${width}%"></i></span>
    </div>
  </div>`;

const productMockup = `
<div class="lp-stage">
  <div class="lp-glow" aria-hidden="true"></div>
  <div class="lp-window" role="img" aria-label="CostFlow report interface showing ranked friction costs">
    <div class="lp-top">
      <span class="lp-tl"></span><span class="lp-tl"></span><span class="lp-tl"></span>
      <span class="lp-urlbar"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="4.5" y="10" width="15" height="10" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>app.fbx1.com/reports</span>
    </div>
    <div class="lp-body">
      <aside class="lp-side">
        <div class="lp-side-brand">${HEADER_MARK}<span>CostFlow</span></div>
        <div class="lp-side-nav">
          <span>Home</span>
          <span class="on"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 10 12 14 15 20 8"/></svg>Reports</span>
          <span>Runs</span>
          <span>Organization</span>
          <span>Settings</span>
        </div>
        <div class="lp-side-foot">
          <span class="lp-avatar">O</span>
          <span>Operations · OPS</span>
        </div>
      </aside>
      <div class="lp-main">
        <div class="lp-report-eyebrow">Friction report</div>
        <div class="lp-report-hero">
          <div class="lp-rh-label">Total priced friction</div>
          <div class="lp-rh-big">$2,229</div>
          <div class="lp-rh-range">1,114 – 4,458 expected range</div>
          <div class="lp-chips">
            <span>5 priced</span><span>0 unpriced</span><span>USD</span><span>Jul 20</span>
          </div>
          <svg class="lp-spark" viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="lpSpark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#8b5cf6" stop-opacity=".55"/>
              <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
            </linearGradient></defs>
            <path d="M0 34 L28 30 L56 32 L84 20 L112 24 L140 12 L168 15 L200 6" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M0 34 L28 30 L56 32 L84 20 L112 24 L140 12 L168 15 L200 6 L200 44 L0 44 Z" fill="url(#lpSpark)"/>
          </svg>
        </div>
        <div class="lp-fr-label">Ranked frictions</div>
        <div class="lp-fr-list">
          ${frictionRow(1, 'Queue wait · To Do', '$1,062', 'C', 100)}
          ${frictionRow(2, 'Overdue exposure · To Do', '$342', 'A', 42)}
          ${frictionRow(3, 'Aging · In Review', '$297', 'B', 34)}
        </div>
      </div>
    </div>
  </div>
</div>`;

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

const hero = `
<section class="lp-hero">
  <div class="lp-aurora" aria-hidden="true"></div>
  <div class="container lp-hero-inner">
    <a class="lp-badge" href="/try"><span class="lp-badge-dot"></span> Free during beta · try a live demo — no signup →</a>
    <h1 class="lp-h1">See what delays in Jira or ClickUp<br><span class="lp-grad">are costing you — in dollars.</span></h1>
    <p class="lp-sub">Connect Jira or ClickUp. Get an itemized, ranked cost report in about a minute —
      every figure traceable to its formula.</p>
    <div class="lp-cta">
      <a class="btn btn-lg" href="/signup">Get started free</a>
      <a class="btn btn-ghost btn-lg" href="/try">Try a live demo</a>
    </div>
    <div class="lp-trust">
      <span>✓ No credit card</span><span>✓ Read-only</span><span>✓ Ready in ~1 minute</span>
    </div>
  </div>
  ${productMockup}
</section>`;

const how = `
<section class="lp-section">
  <div class="container">
    <div class="lp-shead">
      <p class="lp-kicker">How it works</p>
      <h2 class="lp-h2">Your first report in about a minute</h2>
    </div>
    <div class="lp-steps">
      <div class="lp-step">
        <div class="lp-step-viz lp-viz-connect">
          <div class="lp-mini-field"><span>Jira site</span><i>acme.atlassian.net</i></div>
          <div class="lp-mini-field"><span>API token</span><i>••••••••••••</i></div>
          <div class="lp-mini-btn">Validate &amp; connect</div>
        </div>
        <div class="lp-step-num">01</div>
        <h3>Connect your tracker</h3>
        <p>Jira or ClickUp — paste a read-only API token. We never write to your board.</p>
      </div>
      <div class="lp-step">
        <div class="lp-step-viz lp-viz-map">
          <div class="lp-map-row"><span>In Progress</span><em>→</em><i class="lp-tag">active</i></div>
          <div class="lp-map-row"><span>Waiting</span><em>→</em><i class="lp-tag">queue</i></div>
          <div class="lp-map-row"><span>Blocked</span><em>→</em><i class="lp-tag lp-tag-warn">stalled</i></div>
        </div>
        <div class="lp-step-num">02</div>
        <h3>Map &amp; confirm</h3>
        <p>Match statuses to stages and confirm rates. Nothing is priced on a guess you didn't approve.</p>
      </div>
      <div class="lp-step">
        <div class="lp-step-viz lp-viz-report">
          <div class="lp-vr-big">$2,229</div>
          <div class="lp-vr-bar"><i style="width:100%"></i></div>
          <div class="lp-vr-bar"><i style="width:42%"></i></div>
          <div class="lp-vr-bar"><i style="width:34%"></i></div>
        </div>
        <div class="lp-step-num">03</div>
        <h3>Get your report</h3>
        <p>Ranked frictions with cost ranges, confidence tiers, and a formula drill-down for every figure.</p>
      </div>
    </div>
  </div>
</section>`;

const traceable = `
<section class="lp-section lp-section-alt">
  <div class="container lp-split">
    <div class="lp-split-copy">
      <p class="lp-kicker">Defensible by design</p>
      <h2 class="lp-h2">Every number opens up<br>into <span class="lp-grad">exactly how it was computed.</span></h2>
      <p class="lp-lead">No black box. Every figure expands into its formula, inputs, and assumptions —
        and unconfirmed assumptions stay <em>unpriced</em>, never invented.</p>
    </div>
    <div class="lp-split-viz">
      <div class="lp-trace-card">
        <div class="lp-tc-head"><span class="lp-fr-rank">#1</span> Queue wait · To Do <span class="lp-pill lp-pill-C" style="margin-left:auto">● C</span></div>
        <div class="lp-tc-amt">$531 – $2,124 <span>expected ~$1,062</span></div>
        <div class="lp-tc-open">How this number was computed
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </div>
        <div class="lp-tc-detail">
          <div class="lp-tc-line"><span>Formula</span><code>wait_days × rate × attention/day</code></div>
          <div class="lp-tc-line"><span>Items</span><b>18 work items · 1,536 item-hours waiting</b></div>
          <div class="lp-tc-line"><span>Rate</span><b>$95/h · default (customer-accepted)</b></div>
        </div>
      </div>
    </div>
  </div>
</section>`;

const midCta = `
<section class="lp-midcta"><div class="container">
  <a class="btn btn-lg" href="/signup">See what it's costing my team — free</a>
  <p class="lp-midcta-fine">Your own report in about a minute · no credit card · read-only</p>
</div></section>`;

const ICONS = {
  people:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5.5M21 20a6 6 0 0 0-4-5.6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10" width="15" height="10" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
};

const trust = `
<section class="lp-section">
  <div class="container">
    <div class="lp-shead">
      <h2 class="lp-h2">Built to be trusted</h2>
    </div>
    <div class="lp-feat-grid">
      <div class="lp-feat"><span class="lp-feat-ic">${ICONS.people}</span>
        <h3>People are never scored</h3>
        <p>Cost is attributed to processes and stages — never to named individuals.</p></div>
      <div class="lp-feat"><span class="lp-feat-ic">${ICONS.lock}</span>
        <h3>Your data, your control</h3>
        <p>Credentials encrypted at rest. Delete everything, anytime.</p></div>
    </div>
  </div>
</section>`;

/** Single source of truth for the FAQ — rendered as HTML and as FAQPage JSON-LD. */
const FAQ_ITEMS: readonly [string, string][] = [
  [
    'Is it really free? What is the catch?',
    'No catch. CostFlow is a free public beta — no credit card, no trial clock. Paid plans come later; nothing you do now will cost you.',
  ],
  [
    'Will you change anything in my Jira or ClickUp?',
    'Never. CostFlow is read-only — a personal API token, used only to read. No comments, no status changes, nothing written back.',
  ],
  [
    'How are the numbers calculated?',
    'From your imported work items and the rates you confirm. Every figure drills down to its formula and inputs — open the sample report to see exactly how.',
  ],
  [
    'What about privacy and my data?',
    `Credentials are encrypted; individuals are pseudonymized before analysis; you can export or permanently delete everything anytime. See <a href="/privacy">Privacy</a>, or email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.`,
  ],
  [
    'Which tools do you support?',
    'Jira and ClickUp today. Monday, Asana, and CSV import are proven in our engine and coming to the product soon.',
  ],
];

function faq(): string {
  return `<section class="lp-section"><div class="container">
    <div class="lp-shead"><h2 class="lp-h2">FAQ</h2></div>
    <div class="lp-faq">${FAQ_ITEMS.map(
      ([q, a]) => `<details><summary>${q}</summary><p class="note">${a}</p></details>`,
    ).join('')}</div>
  </div></section>`;
}

/** Structured data for the landing (SoftwareApplication + Organization + FAQ + WebSite). */
function landingJsonLd(): string {
  const strip = (html: string): string => html.replace(/<[^>]+>/g, '');
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://app.fbx1.com/#org',
        name: 'CostFlow',
        url: 'https://app.fbx1.com/',
        logo: 'https://app.fbx1.com/brand/logo.svg',
        description:
          'Business Friction Intelligence — price the cost of workflow friction from Jira and ClickUp.',
      },
      {
        '@type': 'WebSite',
        '@id': 'https://app.fbx1.com/#website',
        url: 'https://app.fbx1.com/',
        name: 'CostFlow',
        publisher: { '@id': 'https://app.fbx1.com/#org' },
      },
      {
        '@type': 'SoftwareApplication',
        name: 'CostFlow',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: 'https://app.fbx1.com/',
        description:
          'Connect Jira or ClickUp and CostFlow turns delays, queues, and overdue work into an itemized, ranked cost report — every figure traceable to its formula.',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        publisher: { '@id': 'https://app.fbx1.com/#org' },
      },
      {
        '@type': 'FAQPage',
        mainEntity: FAQ_ITEMS.map(([q, a]) => ({
          '@type': 'Question',
          name: strip(q),
          acceptedAnswer: { '@type': 'Answer', text: strip(a) },
        })),
      },
    ],
  };
  // Escape the one XSS vector in a JSON-LD block (a literal </script>); our copy
  // has none, but keep the invariant explicit.
  return JSON.stringify(graph).replace(/</g, '\\u003c');
}

const ctaBand = `
<section class="lp-section"><div class="container">
  <div class="lp-cta-band">
    <div class="lp-cta-glow" aria-hidden="true"></div>
    <div class="lp-cta-inner">
      <h2 class="lp-cta-h">Find out what your delays<br>are really costing you.</h2>
      <div class="lp-cta-actions"><a class="btn btn-lg lp-cta-btn" href="/signup">Get started free</a>
        <a class="lp-cta-link" href="/try">or try a live demo →</a></div>
      <p class="lp-cta-fine">No credit card · read-only access · delete your data anytime</p>
    </div>
  </div>
</div></section>`;

const footer = `
<footer class="lp-footer"><div class="container">
  <div class="lp-foot-top">
    <span class="lp-foot-brand">${HEADER_MARK}<span>CostFlow</span></span>
    <nav class="lp-foot-links">
      <a href="/demo">Sample report</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a>
      <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
    </nav>
  </div>
  <p class="lp-foot-fine">CostFlow — Business Friction Intelligence. Powered by FBX1.</p>
</div></footer>`;

/* ------------------------------------------------------------------ *
 * Landing-scoped stylesheet
 * ------------------------------------------------------------------ */

const LANDING_STYLE = `
.lp{--vio:#8b5cf6;--ind:#6366f1;--fuchsia:#a855f7}
@keyframes lp-rise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
@keyframes lp-rise-mock{from{opacity:0;transform:translateY(46px) scale(.98)}to{opacity:1;transform:none}}
@keyframes lp-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-11px)}}
@keyframes lp-glow{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.9;transform:scale(1.06)}}
@keyframes lp-shine{to{background-position:220% center}}
@keyframes lp-badgepulse{0%,100%{box-shadow:0 0 0 0 rgba(139,92,246,.5)}50%{box-shadow:0 0 0 6px rgba(139,92,246,0)}}

.lp *{box-sizing:border-box}
.lp-grad{background:linear-gradient(100deg,#6366f1,#8b5cf6,#a855f7,#8b5cf6,#6366f1);background-size:220% auto;
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;animation:lp-shine 7s linear infinite}

/* Hero */
.lp-hero{position:relative;overflow:hidden;padding:clamp(2.5rem,1.5rem+5vw,5rem) 0 clamp(3rem,2rem+4vw,5rem);isolation:isolate}
.lp-aurora{position:absolute;left:50%;top:-24%;width:min(1100px,120%);height:760px;transform:translateX(-50%);z-index:-2;pointer-events:none;
  background:radial-gradient(38% 42% at 30% 30%,rgba(99,102,241,.42),transparent 62%),
    radial-gradient(36% 40% at 72% 26%,rgba(168,85,247,.40),transparent 60%),
    radial-gradient(46% 40% at 50% 8%,rgba(59,130,246,.30),transparent 60%);
  filter:blur(58px);animation:lp-glow 9s ease-in-out infinite}
.lp-hero-inner{position:relative;text-align:center;max-width:52rem;margin-inline:auto}
.lp-badge{display:inline-flex;align-items:center;gap:.55rem;font-size:.82rem;font-weight:560;color:var(--ink);
  padding:.42rem .9rem .42rem .7rem;border-radius:999px;text-decoration:none;
  background:color-mix(in srgb,var(--surface) 62%,transparent);border:1px solid var(--line);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:var(--sh-1);animation:lp-rise .6s var(--ease) both}
.lp-badge:hover{color:var(--ink);border-color:color-mix(in srgb,var(--primary) 40%,var(--line))}
.lp-badge-dot{width:.5rem;height:.5rem;border-radius:50%;background:var(--vio);animation:lp-badgepulse 2.4s ease-in-out infinite}
.lp-h1{font-size:clamp(2.4rem,1.2rem+4.6vw,4.4rem);line-height:1.04;letter-spacing:-.04em;font-weight:680;
  margin:1.5rem auto .3rem;max-width:16ch;animation:lp-rise .7s var(--ease) .05s both}
.lp-sub{font-size:clamp(1.05rem,1rem+.5vw,1.3rem);line-height:1.55;color:var(--muted);max-width:40rem;
  margin:1.1rem auto 0;animation:lp-rise .7s var(--ease) .12s both}
.lp-cta{display:flex;gap:.8rem;justify-content:center;flex-wrap:wrap;margin-top:1.8rem;animation:lp-rise .7s var(--ease) .18s both}
.lp-trust{display:flex;gap:.5rem 1.5rem;justify-content:center;flex-wrap:wrap;margin-top:1.5rem;color:var(--muted);
  font-size:.86rem;font-weight:500;animation:lp-rise .7s var(--ease) .24s both}
.lp-trust span{white-space:nowrap}
.lp-hero-inner{padding-bottom:.5rem}

/* Product mockup */
.lp-stage{position:relative;max-width:64rem;margin-inline:auto;margin-top:clamp(3.5rem,2rem+4vw,6rem);
  padding-inline:clamp(1.15rem,4vw,2rem);animation:lp-rise-mock .9s var(--ease) .28s both}
.lp-glow{position:absolute;left:50%;top:8%;width:78%;height:78%;transform:translateX(-50%);z-index:-1;pointer-events:none;
  background:radial-gradient(closest-side,rgba(139,92,246,.5),rgba(99,102,241,.28),transparent 72%);filter:blur(56px);
  animation:lp-glow 8s ease-in-out infinite}
.lp-window{position:relative;border-radius:18px;overflow:hidden;background:#0c0d16;
  border:1px solid rgba(255,255,255,.10);
  box-shadow:0 2px 0 0 rgba(255,255,255,.05) inset,0 50px 100px -30px rgba(24,18,64,.55),0 24px 50px -24px rgba(24,18,64,.5);
  animation:lp-float 7s ease-in-out infinite}
.lp-top{display:flex;align-items:center;gap:.5rem;height:42px;padding:0 1rem;background:#0a0b12;border-bottom:1px solid rgba(255,255,255,.06)}
.lp-tl{width:11px;height:11px;border-radius:50%;background:#3a3b48}
.lp-tl:nth-child(1){background:#ff5f57}.lp-tl:nth-child(2){background:#febc2e}.lp-tl:nth-child(3){background:#28c840}
.lp-urlbar{display:inline-flex;align-items:center;gap:.4rem;margin:0 auto;padding:.28rem .9rem;border-radius:7px;
  background:rgba(255,255,255,.05);color:#8b8fa6;font-size:.76rem;font-family:var(--mono);letter-spacing:-.01em}
.lp-body{display:flex;min-height:340px;background:#0c0d16;background-image:radial-gradient(60% 60% at 78% 0%,rgba(139,92,246,.10),transparent 60%)}
.lp-side{width:200px;flex:none;padding:1.1rem 1rem;border-right:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;gap:1.1rem}
.lp-side-brand{display:flex;align-items:center;gap:.5rem;font-weight:660;color:#eef;font-size:.98rem}
.lp-side-brand svg{width:20px;height:20px}
.lp-side-nav{display:flex;flex-direction:column;gap:.15rem;margin-top:.2rem}
.lp-side-nav span{display:flex;align-items:center;gap:.55rem;font-size:.86rem;color:#8589a0;padding:.42rem .6rem;border-radius:8px;font-weight:500}
.lp-side-nav .on{color:#d6ccff;background:rgba(139,92,246,.16);font-weight:600}
.lp-side-foot{margin-top:auto;display:flex;align-items:center;gap:.55rem;font-size:.8rem;color:#6f7288;
  padding-top:.9rem;border-top:1px solid rgba(255,255,255,.06)}
.lp-avatar{width:1.5rem;height:1.5rem;border-radius:7px;display:grid;place-items:center;font-size:.75rem;font-weight:700;color:#fff;
  background:linear-gradient(135deg,#6366f1,#a855f7)}
.lp-main{flex:1;min-width:0;padding:1.4rem 1.5rem 1.6rem}
.lp-report-eyebrow{display:inline-block;font-size:.66rem;font-weight:680;letter-spacing:.09em;text-transform:uppercase;
  color:#b9a7ff;background:rgba(139,92,246,.14);border:1px solid rgba(139,92,246,.28);padding:.24rem .6rem;border-radius:999px}
.lp-report-hero{position:relative;margin-top:.9rem;padding:1.2rem 1.3rem;border-radius:14px;
  background:linear-gradient(135deg,rgba(99,102,241,.14),rgba(168,85,247,.10));border:1px solid rgba(139,92,246,.22);overflow:hidden}
.lp-rh-label{font-size:.68rem;font-weight:640;letter-spacing:.08em;text-transform:uppercase;color:#a9adc6}
.lp-rh-big{font-size:clamp(1.9rem,1rem+3vw,2.7rem);font-weight:720;letter-spacing:-.03em;line-height:1.05;margin-top:.15rem;
  background:linear-gradient(120deg,#c4b5fd,#a855f7);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lp-rh-range{font-size:.8rem;color:#9498b2;margin-top:.15rem}
.lp-chips{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.7rem}
.lp-chips span{font-size:.68rem;color:#a2a6bf;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);
  padding:.18rem .5rem;border-radius:999px}
.lp-spark{position:absolute;right:1rem;bottom:0;width:200px;max-width:44%;height:44px;opacity:.85}
.lp-fr-label{font-size:.72rem;font-weight:640;letter-spacing:.06em;text-transform:uppercase;color:#8589a0;margin:1.1rem 0 .55rem}
.lp-fr-list{display:flex;flex-direction:column;gap:.55rem}
.lp-fr{padding:.7rem .85rem;border-radius:11px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07)}
.lp-fr-head{display:flex;align-items:center;gap:.5rem}
.lp-fr-rank{font-size:.72rem;font-weight:700;color:#7d8198}
.lp-fr-title{font-size:.85rem;font-weight:600;color:#e6e7f0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lp-fr-foot{display:flex;align-items:center;gap:.7rem;margin-top:.45rem}
.lp-fr-amt{font-size:.82rem;font-weight:680;color:#fff;font-variant-numeric:tabular-nums;min-width:3.4rem}
.lp-bar{flex:1;height:6px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden}
.lp-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#6366f1,#a855f7)}
.lp-pill{font-size:.66rem;font-weight:680;padding:.14rem .5rem;border-radius:999px;border:1px solid;white-space:nowrap;letter-spacing:.02em}
.lp-pill-A{color:#5fe3b0;background:rgba(16,185,129,.14);border-color:rgba(16,185,129,.34)}
.lp-pill-B{color:#f4c36b;background:rgba(245,158,11,.14);border-color:rgba(245,158,11,.34)}
.lp-pill-C{color:#f79a9d;background:rgba(239,68,68,.14);border-color:rgba(239,68,68,.34)}

/* Sections */
.lp-section{padding:clamp(3rem,2rem+4vw,6rem) 0}
.lp-section-alt{background:var(--bg-2);border-block:1px solid var(--line)}
.lp-shead{text-align:center;max-width:42rem;margin-inline:auto;margin-bottom:clamp(2.2rem,1.5rem+2vw,3.2rem)}
.lp-kicker{display:inline-block;font-size:.76rem;font-weight:680;letter-spacing:.1em;text-transform:uppercase;color:var(--primary);margin:0 0 .7rem}
.lp-h2{font-size:clamp(1.7rem,1.2rem+2vw,2.7rem);line-height:1.1;letter-spacing:-.03em;font-weight:660;margin:0}
.lp-lead{font-size:clamp(1.02rem,1rem+.4vw,1.2rem);color:var(--muted);margin:.8rem auto 0;line-height:1.55}

/* How-it-works steps — fixed 3 columns so the third never orphans */
.lp-steps{display:grid;gap:1.4rem;grid-template-columns:repeat(3,minmax(0,1fr))}
.lp-step{position:relative;padding:1.5rem;border-radius:18px;background:var(--surface);border:1px solid var(--line);box-shadow:var(--sh-1);
  transition:transform .2s var(--ease),box-shadow .2s var(--ease),border-color .2s var(--ease)}
.lp-step:hover{transform:translateY(-4px);box-shadow:var(--sh-2);border-color:color-mix(in srgb,var(--primary) 24%,var(--line))}
.lp-step-viz{height:9rem;border-radius:13px;margin-bottom:1.3rem;padding:1rem;overflow:hidden;position:relative;
  background:linear-gradient(160deg,var(--grad-soft),transparent);border:1px solid var(--line);display:flex;flex-direction:column;gap:.5rem;justify-content:center}
.lp-step-num{font-size:.8rem;font-weight:720;letter-spacing:.06em;color:var(--primary)}
.lp-step h3{margin:.4rem 0 .4rem;font-size:1.15rem}
.lp-step p{margin:0;color:var(--muted);font-size:.94rem}
.lp-mini-field{display:flex;justify-content:space-between;align-items:center;font-size:.76rem;background:var(--surface);
  border:1px solid var(--line);border-radius:8px;padding:.42rem .6rem;box-shadow:var(--sh-1)}
.lp-mini-field span{color:var(--muted)} .lp-mini-field i{font-style:normal;font-family:var(--mono);color:var(--ink);font-size:.72rem}
.lp-mini-btn{align-self:flex-start;font-size:.74rem;font-weight:620;color:#fff;background:var(--grad);padding:.4rem .8rem;border-radius:8px;box-shadow:var(--sh-2)}
.lp-map-row{display:flex;align-items:center;gap:.5rem;font-size:.78rem;color:var(--ink)}
.lp-map-row span{background:var(--surface);border:1px solid var(--line);border-radius:7px;padding:.28rem .5rem;box-shadow:var(--sh-1)}
.lp-map-row em{color:var(--faint);font-style:normal}
.lp-tag{font-size:.68rem;font-weight:640;color:var(--primary);background:var(--grad-soft);border:1px solid color-mix(in srgb,var(--primary) 22%,transparent);padding:.2rem .5rem;border-radius:999px}
.lp-tag-warn{color:var(--warn-ink);background:var(--warn-bg);border-color:var(--warn-line)}
.lp-viz-report{justify-content:center;gap:.45rem}
.lp-vr-big{font-size:1.7rem;font-weight:720;letter-spacing:-.02em;background:var(--grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lp-vr-bar{height:7px;border-radius:999px;background:color-mix(in srgb,var(--primary) 12%,transparent);overflow:hidden}
.lp-vr-bar i{display:block;height:100%;border-radius:999px;background:var(--grad)}

/* Split storytelling */
.lp-split{display:grid;gap:clamp(2rem,1rem+3vw,4rem);grid-template-columns:1fr 1fr;align-items:center}
.lp-split-copy .lp-h2{text-align:left}
.lp-split-viz{position:relative}
.lp-trace-card{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:1.4rem;box-shadow:var(--sh-3);
  transition:transform .3s var(--ease)}
.lp-split-viz::before{content:'';position:absolute;inset:6% 10%;z-index:-1;border-radius:24px;
  background:radial-gradient(closest-side,rgba(139,92,246,.28),transparent 75%);filter:blur(40px)}
.lp-tc-head{display:flex;align-items:center;gap:.5rem;font-size:.95rem;font-weight:600;color:var(--ink)}
.lp-tc-amt{font-size:1.4rem;font-weight:700;letter-spacing:-.02em;margin:.6rem 0 .1rem;color:var(--ink)}
.lp-tc-amt span{font-size:.85rem;font-weight:500;color:var(--muted)}
.lp-tc-open{display:flex;align-items:center;gap:.4rem;font-size:.85rem;font-weight:600;color:var(--primary);margin:1rem 0 .7rem;
  padding-top:.9rem;border-top:1px solid var(--line-2)}
.lp-tc-detail{display:flex;flex-direction:column;gap:.5rem}
.lp-tc-line{display:flex;gap:.6rem;font-size:.84rem;align-items:baseline}
.lp-tc-line span{color:var(--faint);width:3.4rem;flex:none;font-weight:560}
.lp-tc-line b{color:var(--ink);font-weight:560}
.lp-tc-line code{font-family:var(--mono);font-size:.78rem;background:var(--grad-soft);color:var(--primary);border:1px solid color-mix(in srgb,var(--primary) 18%,transparent);padding:.14rem .4rem;border-radius:6px}

/* Feature grid — two cards, centered (2 / 1) */
.lp-feat-grid{display:grid;gap:1.3rem;grid-template-columns:repeat(2,minmax(0,1fr));max-width:46rem;margin-inline:auto}
.lp-feat{padding:1.6rem;border-radius:18px;background:var(--surface);border:1px solid var(--line);box-shadow:var(--sh-1);
  transition:transform .2s var(--ease),box-shadow .2s var(--ease),border-color .2s var(--ease)}
.lp-feat:hover{transform:translateY(-4px);box-shadow:var(--sh-2);border-color:color-mix(in srgb,var(--primary) 22%,var(--line))}
.lp-feat-ic{display:inline-flex;width:2.7rem;height:2.7rem;align-items:center;justify-content:center;border-radius:13px;
  background:var(--grad-soft);color:var(--primary);border:1px solid color-mix(in srgb,var(--primary) 18%,transparent);margin-bottom:1rem}
.lp-feat-ic svg{width:1.35rem;height:1.35rem}
.lp-feat h3{margin:0 0 .4rem;font-size:1.12rem}
.lp-feat p{margin:0;color:var(--muted);font-size:.94rem}

/* FAQ */
.lp-faq{max-width:44rem;margin:0 auto}

/* CTA band */
.lp-cta-band{position:relative;overflow:hidden;border-radius:28px;padding:clamp(2.6rem,2rem+3vw,4.5rem) 1.5rem;text-align:center;
  background:linear-gradient(140deg,#171528,#0d0b1a 60%);border:1px solid rgba(139,92,246,.25);box-shadow:var(--sh-3)}
.lp-cta-glow{position:absolute;left:50%;top:-40%;width:70%;height:130%;transform:translateX(-50%);pointer-events:none;
  background:radial-gradient(closest-side,rgba(139,92,246,.55),rgba(99,102,241,.25),transparent 72%);filter:blur(50px);animation:lp-glow 8s ease-in-out infinite}
.lp-cta-inner{position:relative;z-index:1}
.lp-cta-h{font-size:clamp(1.7rem,1.2rem+2.4vw,2.9rem);line-height:1.08;letter-spacing:-.03em;font-weight:680;color:#fff;margin:.6rem 0 0}
.lp-cta-actions{display:flex;gap:1rem;align-items:center;justify-content:center;flex-wrap:wrap;margin-top:1.8rem}
a.lp-cta-btn,.lp-cta-btn{background:#fff;color:#4c43d6}
a.lp-cta-btn:hover,.lp-cta-btn:hover{background:#fff;color:#4c43d6;filter:brightness(1.02)}
.lp-cta-link{color:#c4b5fd;font-weight:600;font-size:.95rem}
.lp-cta-link:hover{color:#fff}
.lp-cta-fine{color:#9498b2;font-size:.85rem;margin:1.1rem 0 0}

/* Mid-page CTA (post-proof) */
.lp-midcta{text-align:center;padding:clamp(1.5rem,1rem+2vw,3rem) 0 0}
.lp-midcta-fine{color:var(--muted);font-size:.88rem;margin:.9rem 0 0}

/* Footer */
.lp-footer{border-top:1px solid var(--line);padding:2.6rem 0;background:var(--bg-2)}
.lp-foot-top{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.lp-foot-brand{display:inline-flex;align-items:center;gap:.5rem;font-weight:660;color:var(--ink)}
.lp-foot-brand svg{width:20px;height:20px}
.lp-foot-links{display:flex;gap:1.3rem;flex-wrap:wrap}
.lp-foot-links a{color:var(--muted);font-size:.92rem}
.lp-foot-links a:hover{color:var(--ink)}
.lp-foot-fine{color:var(--faint);font-size:.86rem;margin:1.2rem 0 0}

@media (max-width:860px){
  .lp-steps{grid-template-columns:1fr;max-width:26rem;margin-inline:auto}
  .lp-split{grid-template-columns:1fr}
  .lp-split-copy .lp-h2{text-align:center}
  .lp-split-copy .lp-shead,.lp-split-copy{text-align:center}
}
@media (max-width:560px){
  .lp-side{display:none}
  .lp-cta .btn{width:100%}
  .lp-feat-grid{grid-template-columns:1fr;max-width:26rem;margin-inline:auto}
}
@media (prefers-reduced-motion:reduce){
  .lp *,.lp-window,.lp-glow,.lp-aurora,.lp-cta-glow,.lp-grad,.lp-badge-dot{animation:none!important}
}
`;

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

/** Marketing landing shown to logged-out visitors at `/`. */
export function renderLanding(): string {
  const body = `<style>${LANDING_STYLE}</style><div class="lp">${hero}${how}${traceable}${midCta}${trust}${faq()}${ctaBand}${footer}</div>`;
  return layout('CostFlow — see what friction costs your team', body, undefined, {
    bleed: true,
    canonical: 'https://app.fbx1.com/',
    jsonLd: landingJsonLd(),
  });
}

/** Shared shell for the legal/long-form pages (Terms, Privacy). */
function legalPage(title: string, inner: string, path: string): string {
  const body = `<article class="panel" style="max-width:46rem;margin-inline:auto">${inner}</article>`;
  return layout(`${title} — CostFlow`, body, undefined, {
    canonical: `https://app.fbx1.com${path}`,
  });
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
    '/terms',
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
    '/privacy',
  );
}
