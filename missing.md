# Missing Pages & Nav/Footer Audit

What a real B2B SaaS site (Stripe/Linear/Vercel/Ramp-tier) has that CostFlow doesn't yet. Compiled from the actual route table (`server.ts`, `auth.ts`) and the current nav/footer markup (`html.ts`, `landing.ts`) — nothing here is guessed, every "missing" item below was checked against the live route list first.

---

## Current state (baseline)

**Navbar (logged-out)**: `Sample report` · `Sign in` · `Get started` — that's the whole thing.

**Footer** (landing page only — every other page has _no footer at all_, just the header): brand mark, `Sample report` · `Terms` · `Privacy` · support email, one line of copyright. Four links, one column, no social icons.

**Full route table today**: `/`, `/demo`, `/try`, `/try/report`, `/logged-out`, `/terms`, `/privacy`, plus the authenticated app (`/connect`, `/scope`, `/mapping/*`, `/assumptions`, `/dashboard`, `/runs`, `/reports/*`, `/settings`, `/org/*`, `/workspaces/*`, `/account/delete`, `/admin/*`, `/invite/:token`, `/jobs/:jobId`) and auth (`/login`, `/signup`, `/logout`, `/auth/callback`).

Zero marketing/trust/company pages exist beyond Terms and Privacy.

---

## Missing — Navbar

| Item                                  | Why real companies have it                                                                                                                                                                 | Priority                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **Pricing** link + `/pricing` page    | Beta is free today, but "no pricing page" reads as unfinished/pre-launch even for a free beta — Stripe/Linear/Vercel all show pricing (or "Free" tier) even before GA                      | High                                                            |
| **Product/Features** dropdown or link | Right now the only product info is the hero — no dedicated features/how-it-works page to link deep from ads, SEO, or sales conversations                                                   | Medium                                                          |
| **Docs/Resources** link               | No `/docs` at all — nowhere to point an evaluating engineer for API/setup details beyond the in-product help text                                                                          | Medium                                                          |
| **Company/About** link                | No `/about` — no founder story, no "who's behind this," which matters a lot for trust when asking someone to connect Jira credentials                                                      | Medium                                                          |
| **Blog/Changelog** link               | No way to show the product is actively developed — no changelog, no blog                                                                                                                   | Low–Medium                                                      |
| Mobile nav (hamburger menu)           | Current header has no collapsed/mobile nav pattern — `.nav-extra` just `display:none`s under 560px, so mobile visitors lose "Sample report" and "Sign in" entirely, not tucked into a menu | High (this is a real UX regression, not just a missing "extra") |

---

## Missing — Footer

Real companies structure the footer in columns (Product / Company / Resources / Legal) plus a social row. CostFlow's footer is one flat row of 3 links. Missing:

### Product column

- `/pricing`
- `/security` — security & compliance one-pager (SOC 2 status, encryption-at-rest claims already made in-copy on the landing page but never linked to a page that substantiates them)
- `/changelog`
- `/integrations` — currently "Jira and ClickUp today, Monday/Asana/CSV next" is only mentioned in one FAQ answer, no dedicated page
- `/status` — uptime/incident status page (even a simple one; every SaaS company has a status.example.com or /status link, especially one asking for API tokens)

### Company column

- `/about`
- `/careers` (even a "we're not hiring yet" stub beats a dead link — but right now there's no link at all)
- `/blog`
- `/customers` or `/case-studies`
- `/contact` — there is a support **email** but no contact **page** (no sales contact path for a team lead evaluating this for their org)

### Resources column

- `/docs`
- `/help` or `/support` — a real help center, distinct from the mailto: link
- `/api` or API reference (product touches Jira/ClickUp APIs; technical buyers will look for this)
- `/faq` as a standalone page — currently FAQ only exists as a landing-page section, not a linkable page (e.g., from a support email reply)

### Legal column

- `/cookies` — cookie policy (Terms/Privacy exist; no cookie-specific policy, and no cookie consent banner in the CSP-strict, no-JS architecture — worth deciding if this is even needed given the app sets no non-essential cookies, but it should be a _decision_, not an omission)
- `/dpa` or `/subprocessors` — data processing agreement / subprocessor list (a B2B buyer's security/legal team will ask for this before green-lighting API token access)
- `/accessibility` — accessibility statement (VPAT-style) — notable given the product otherwise cares about WCAG-adjacent details (focus states, contrast)
- `/sitemap` (human-readable; `/sitemap.xml` exists for crawlers but there's no human sitemap page)

### Social / trust row

- No social links at all (Twitter/X, LinkedIn, GitHub) — even a solo/small team benefits from _a_ link so the footer doesn't look abandoned
- No "SOC 2" / "GDPR-ready" / compliance badges — copy on the landing page already claims encryption-at-rest and pseudonymization; a real company surfaces that as a badge/icon row, not just prose

---

## Missing — Standalone pages (beyond nav/footer)

| Page                            | Why it matters                                                                                                                                                                                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/pricing`                      | Biggest single gap. Even "free during beta, here's what paid looks like later" is standard — visitors actively look for this before connecting a work-tracking API token                                                                                                                  |
| `/security`                     | The landing page and Privacy policy both make specific security claims (encrypted at rest, pseudonymized, isolated per-org) — a dedicated trust page consolidating these (with the same claims, not new ones) is what turns "trust me" into "here's the page my security team can review" |
| `/about`                        | No founder/company story anywhere. `CostFlow is an FBX1 product` is the only company-identity text on the entire site                                                                                                                                                                     |
| `/contact` or a real sales path | Only contact method site-wide is a mailto: link in the footer and FAQ                                                                                                                                                                                                                     |
| `/changelog`                    | No visible product-velocity signal                                                                                                                                                                                                                                                        |
| `/blog`                         | No content marketing/SEO surface — fine to skip for a v1 beta, but worth naming explicitly as a deliberate gap rather than an oversight                                                                                                                                                   |
| `/careers`                      | Optional at this stage, but a dead spot in the Company column if that column gets built without it                                                                                                                                                                                        |
| `/docs`                         | No technical documentation surface distinct from in-app help text and the connect-flow's inline help                                                                                                                                                                                      |
| `/404` custom copy              | Already exists and is well-designed (`empty` state pattern) — not missing, noted here only for completeness                                                                                                                                                                               |

---

## What's explicitly _not_ missing (don't rebuild these)

- Terms (`/terms`) and Privacy (`/privacy`) — exist, redesigned, on-brand.
- 404 / not-found page — exists, on-brand.
- `/sitemap.xml`, `/robots.txt` — exist, crawler-facing, correct.
- The entire authenticated product (onboarding wizard, dashboard, reports, org/settings) — exists, inherits the new design system (see prior audit).

---

## Suggested build order (if you want to close these gaps)

1. **Mobile nav fix** — real UX bug today, not a "nice to have."
2. **`/pricing`** — highest-impact missing page for conversion/trust.
3. **`/security`** — second highest; directly de-risks the "give us your API token" ask.
4. **Footer restructure** — columns (Product/Company/Resources/Legal) + social row, even before every linked page exists (link what's real, stub or omit the rest deliberately rather than a flat 3-link row).
5. **`/about`, `/contact`** — cheap to build, meaningfully raises trust.
6. **`/changelog`, `/docs`, `/careers`, `/blog`** — build as the product/company actually grows into needing them; premature to fully build pre-launch.

Nothing in this file has been built yet — this is the audit only, per request.
