# CostFlow (app.fbx1.com) — Black-Box QA Report

**Status: DONE** — all code-fixable findings applied and verified live (2026-07-27). One finding (#1) is an infra/tenant-config issue, not a code fix; noted below.

**Test date:** 2026-07-27
**Environment:** Chromium, viewports 375 / 768 / 1280
**Scope:** Live app only, no source access.

## Summary

Well-built, privacy-first marketing site + server-rendered demo report engine. Zero-JS architecture (CSP `script-src 'none'`), strong security headers, no console errors, no failed requests, clean responsive behavior, working keyboard focus, proper 404. Input handling on demo engine hardened against injection/malformed input. Biggest issue: auth wired to a **dev-tier Auth0 tenant in production**. Rest is minor a11y/UX polish.

## App map (all routes verified 200)

- Marketing: `/`, `/pricing`, `/docs`, `/about`, `/blog`, `/security`, `/faq`, `/changelog`, `/careers`, `/contact`
- Demo engine: `/try` (random synthetic company → `/try/report?seed=N`), `/demo` (static sample report)
- Auth (external Auth0): `/login`, `/signup` → `dev-0l6ne8ms0d1s30aw.us.auth0.com`
- Legal: `/terms`, `/privacy`, `/cookies`, `/dpa`, `/accessibility`
- Error: unknown path → proper 404

---

## Findings (fix these)

### 1. [HIGH] Auth runs on dev-tier Auth0 tenant in production — **NOT CODE-FIXABLE**

> **Status: Deferred.** This is an Auth0 tenant/ops configuration choice (which tenant `auth.ts`/`config.ts` point at), not a bug in the code — `config.ts` already refuses to boot in production with dev auth. Fix is to provision a production Auth0 tenant + custom domain and point prod env vars at it; no source change applies here.

- **Where:** `/login`, `/signup` → redirects to `https://dev-0l6ne8ms0d1s30aw.us.auth0.com`
- **Evidence:**
  - Red "dev keys" warning triangle on hosted login page
  - Raw internal tenant ID shown to users: "Log in to dev-0l6ne8ms0d1s30aw to continue to CostFlow"
  - Page unbranded (generic shield icon, no CostFlow logo)
  - "Continue with Google" uses shared Auth0 dev Google keys → triggers "unverified app" warning, not prod-safe
- **Repro:** Click "Sign in" or "Get started" from any page.
- **Expected:** Production custom Auth0 domain (e.g. `auth.fbx1.com`), CostFlow branding, no dev-keys warning.
- **Actual:** Dev tenant exposed, unbranded, warning shown.
- Not functionally tested past handoff (no credential entry per policy).

### 2. [LOW / A11y] Missing spaces around `<br>` in headings — mispronunciation + bad copy extraction

> **Status: FIXED.** Added a literal space before each `<br>` in [landing.ts](apps/web/src/landing.ts) (hero H1, "opens up" H2, CTA-band H2). Verified live.

- **Where:** `/` homepage headings (pattern likely reused elsewhere)
- **Examples:**
  - H1: `...Jira or ClickUp<br><span>are...` → reads "ClickUpare"
  - H2: `Every number opens up<br>into...` → reads "opens upinto"
  - H2: `Find out what your delays<br>are...` → reads "delaysare"
- **Fix:** Preserve a space across the break so accessible text reads "ClickUp are", "opens up into", "delays are".

### 3. [LOW / A11y] Footer heading hierarchy skips a level

> **Status: FIXED.** Footer column labels in [html.ts](apps/web/src/html.ts) changed from `<h4>` to a non-heading `<p class="sf-col-h">` (same visual style, `aria-label` added to each nav), so the footer no longer injects a heading level into the page outline. Verified live.

- **Where:** Global footer (all pages)
- **Issue:** "Product"/"Company"/"Resources"/"Legal" are `<h4>` directly under page `<h2>` — no `<h3>` in between. Breaks screen-reader heading navigation.
- **Fix:** Use sequential heading levels, or switch these to non-heading labels (e.g. styled `<p>`/`<span>` with `aria-label` on the nav).

### 4. [LOW / UX] Non-interactive cards look clickable

> **Status: FIXED.** `/docs` sections in [html.ts](apps/web/src/html.ts) restyled from a bordered/shadowed box (`.ws`) to a flat block with a left accent bar — no longer reads as a card. `/blog` placeholder cards keep their card look (they're grouped content, not single items) but lost the hover-lift affordance (`.feature.is-static`) since they aren't links. Verified live.

- **Where:** `/docs` (e.g. "Getting started", "Connecting Jira" cards), `/blog` (placeholder post cards)
- **Issue:** Bordered card style implies clickability but there's no `href`/hover affordance — users will try to click.
- **Fix:** Either make them real links, or restyle so they read as static content.

### 5. [LOW / Cosmetic] Sticky header overlaps content on scroll

> **Status: FIXED.** Added `scroll-padding-top:80px` on `html` in [html.ts](apps/web/src/html.ts), clearing the 64px sticky header for any in-page/anchor/focus scroll site-wide.

- **Where:** `/pricing` (shared sticky header, likely global)
- **Issue:** Fixed translucent header overlays scrolled-to content — e.g. "Limited" plan card heading sits partly under the header band.
- **Fix:** Add scroll-margin-top / scroll-padding-top on sections to clear the sticky header height.

---

## Verified OK (no action needed)

**Functional**

- `/try` demo generates fresh random company each run, redirects to `/try/report?seed=N`
- Drill-down accordions and FAQ accordions work correctly (native `<details>`)
- Pricing CTAs correct: Get started free / Start with Pro → `/signup`; Talk to us → `mailto:support@fbx1.com`
- Auth0 required-field validation works
- 404 returns real HTTP 404 with friendly page + footer

**Responsive**

- No horizontal scroll leak at any breakpoint (375/768/1280)
- Nav collapses to hamburger below desktop, all links present in mobile menu
- Wide data tables wrapped in `overflow-x:auto`, scroll within card

**Accessibility**

- `<html lang="en">`, unique titles, single H1/page, viewport meta present
- "Skip to content" link works, visible 2px focus outline throughout
- No missing alt text, no empty links/buttons
- No genuine color-contrast failures (automated flags were false positives on gradient buttons / dark report mockup image)

**Performance**

- Zero console errors/warnings, zero failed network requests across all pages
- Icons are inline SVG data-URIs, only 2 raster assets (both 200)
- `/try` "Analyzing a live company" ~5-6s delay is intentional server-side, not a hang

**Security**

- HTTPS + HSTS (`max-age=31536000; includeSubDomains`)
- Strict CSP (`script-src 'none'`, `frame-ancestors 'none'`, locked `form-action`/`img-src`/`connect-src`)
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, locked `Permissions-Policy`
- No `X-Powered-By` leak
- Injection tests on `/try/report?seed=` (`abc`, `-1`, huge int, `<script>alert(1)</script>`, missing) all handled safely — no reflection, no stack trace leaks
- No cookies, no local/session storage on marketing pages (matches stated "one cookie" policy)

## Not tested

- Authenticated app (Reports/Runs/Organization/Settings) — requires account creation/credentials, out of scope for this pass.

## Priority fix order

1. Auth0 dev tenant → prod tenant + branding (High)
2. `<br>` spacing in headings (quick copy fix)
3. Footer heading levels
4. Docs/blog card affordance
5. Sticky header scroll offset
