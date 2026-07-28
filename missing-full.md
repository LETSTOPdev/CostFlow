# Missing Pages — Full Copy

Text only, no layout or components yet. Every page below is written to drop into the existing shell (`layout()` in `html.ts`) once someone builds the templates. Nothing here invents facts about CostFlow's history, team, or certifications that aren't already true in the product or the code. Where I didn't have a real fact to work with, I said so plainly instead of making one up. Notes on that are called out per page.

---

## 1. Pricing — `/pricing`

**Meta title:** Pricing | CostFlow
**Meta description:** Start free. Pay per person once you need the whole team on it.

### Page copy

**Eyebrow:** Pricing

**H1:** Simple, per-person pricing. Start free.

**Lead:** One plan to see what CostFlow can do, one plan to run it for real, one plan for teams with a security review to get through first.

**Body (sits above the plan cards):**

No setup fees, no annual lock-in to get started, no sales call required for the first two plans. Every plan connects Jira or ClickUp the same way: read-only, encrypted, revocable whenever you want.

### Limited — $0 / month

For seeing if this is worth it before you commit anyone else's time.

- 1 workspace, 1 connected tracker (Jira or ClickUp)
- Up to 3 team members
- Up to 3 analysis runs per month
- 30-day report history
- Formula drill-down on every number
- Email support

**CTA:** Get started free

### Pro — $20 / user / month

For teams that want this running every week, not just once to see the number.

- Everything in Limited, plus:
- Unlimited analysis runs
- Unlimited report history
- Unlimited team members (billed per active seat)
- CSV and raw JSON export on every report
- Multiple workspaces per organization
- Priority email support

**CTA:** Start with Pro

### Enterprise — $100 / user / month

For teams whose security review is the thing standing between "interested" and "connected."

- Everything in Pro, plus:
- SSO / SAML sign-in for your whole org
- Audit logs across workspaces and members
- A signed Data Processing Agreement, not just a page about one
- Dedicated support contact and a real SLA
- Org-wide role and workspace management

**CTA:** Talk to us → [support@fbx1.com](mailto:support@fbx1.com)

**Mini-FAQ:**

**Do I need a credit card for the Limited plan?**
No. It's free for as long as you want to stay on it.

**Is Pro billed per seat or a flat rate?**
Per seat. $20 for every team member with an active login that month, not a flat per-workspace fee.

**Can I start on Limited and upgrade later without losing anything?**
Yes. Your workspace, connections, and report history carry over. Upgrading just removes the caps.

**What if we need to negotiate Enterprise pricing or terms?**
Email [support@fbx1.com](mailto:support@fbx1.com). $100/user/month is the list price; larger teams and longer commitments are exactly what that conversation is for.

**CTA:** Get started free → `/signup`

---

## 2. Security — `/security`

**Meta title:** Security | CostFlow
**Meta description:** How CostFlow handles your workspace data, credentials, and individual privacy, in plain language.

### Page copy

**Eyebrow:** Security

**H1:** Built to be trusted with something you didn't have to give us.

**Lead:** You're handing CostFlow an API token into your team's work-tracking system. Here's exactly what we do with it, and what we never do.

**Section: Read-only, always**

CostFlow connects to Jira and ClickUp with a personal API token you provide, and it only reads. It doesn't write comments, change statuses, move tickets, or touch your board in any way. Revoke the token and the connection stops working immediately. That's the whole mechanism; there's no separate opt-out to remember.

**Section: Credentials, encrypted**

Your API token is encrypted at rest. Nobody at CostFlow can read it back out in plain text once it's saved, including us. It's used exactly once per analysis run, to fetch your data, and then it's done.

**Section: People aren't the product**

Every individual in your imported data is pseudonymized before analysis runs. No report, export, or dashboard ranks or scores a named person. Cost is attributed to processes and stages, queues, delays, overdue work, not to whoever happened to touch the ticket.

**Section: Your organization's data stays yours**

Every organization's data is isolated from every other organization's. There's no cross-tenant reporting, no aggregate benchmarking that mixes your numbers with someone else's, and no way for another CostFlow customer to see anything about your workspace.

**Section: We don't track you to sell you anything**

CostFlow ships with no third-party analytics, no ad trackers, no session replay tools. The strict content policy on every page blocks third-party scripts outright. It's not a settings toggle; it's how the app is built. What little product analytics we keep is aggregate counts, like how many organizations reach a given step, never your content.

**Section: Delete anytime, actually**

You can delete a workspace or your entire organization whenever you want. Deletion cascades to every report derived from that data. We don't keep a "just in case" copy.

**Section: Where we're headed**

CostFlow is a beta product from a small team. We haven't gone through a formal SOC 2 audit yet. We're building toward that as the product and the team grow, and we'll say so here the moment it's real rather than before. If your security team needs something specific to evaluate us, a data flow diagram, a subprocessor list, answers to a vendor questionnaire, email us and we'll get it to you directly.

**CTA:** Questions before you connect? [support@fbx1.com](mailto:support@fbx1.com)

_(Note: don't add a SOC 2 / ISO badge to this page until one is real. The honesty is the trust signal at this stage. A fake badge is worse than no badge.)_

---

## 3. About — `/about`

**Meta title:** About | CostFlow
**Meta description:** CostFlow is built by FBX1. We build focused software for problems that are usually left to guesswork.

### Page copy

**Eyebrow:** About

**H1:** We build things that tell you what's actually happening.

**Lead:** CostFlow is an FBX1 product. FBX1 builds small, focused tools for problems that most companies solve with a spreadsheet, a gut feeling, or nothing at all.

**Body:**

A lot of software tells you what happened. Fewer tools tell you what it cost, in a way you can actually trace back to a number. That gap is where FBX1 starts: pick a problem people are already feeling, and build the smallest thing that answers it honestly.

CostFlow is the first shape that took. Every team using Jira or ClickUp has delays, queues, and stalled work sitting in their board right now. Most of them have never seen a dollar figure attached to it, because nobody's built the thing that does that well. We did.

We're not trying to be a platform, a suite, or a "system of record" for anything. We'd rather ship one thing that works than five things that sort of do. If CostFlow stops being useful to you, we want that to be obvious, not hidden behind a subscription you forgot to cancel.

**Section: What we're building toward**

Right now that means Jira and ClickUp, priced friction, and a report you can hand to your team without arguing about the methodology. Next means more places that data lives, and more of the workflow that's currently invisible until someone finally asks: wait, how long has this been sitting here?

**Section: Talk to us**

We're a small team building this in the open, during a free beta, because we'd rather build it with the people who'll actually use it than in a vacuum. If something's wrong, confusing, or missing, we want to hear about it. [support@fbx1.com](mailto:support@fbx1.com) reaches actual humans, not a ticket queue.

**CTA:** See what it's costing your team → `/signup`

_(Note per your instruction: no invented founder names, headcount, funding, or founding date. None of that is asserted here. If you want real specifics on this page later, swap them in; don't let me guess at them.)_

---

## 4. Contact — `/contact`

**Meta title:** Contact | CostFlow
**Meta description:** One real way to reach CostFlow: email. We read everything.

### Page copy

**Eyebrow:** Contact

**H1:** Talk to us directly.

**Lead:** CostFlow doesn't have a support ticket queue or a chatbot standing between you and an answer. Email us and a person reads it.

**Body:**

**General questions, support, feedback:** [support@fbx1.com](mailto:support@fbx1.com)
We aim to reply within one business day. During beta, that's usually faster.

**Evaluating CostFlow for your team?**
Tell us your provider (Jira or ClickUp), roughly how many people are on the team, and what you're trying to figure out. That's enough for us to give you a real answer instead of a generic one.

**Found a security issue?**
Email the same address with "security" in the subject line. We'll prioritize it.

**Press or partnerships?**
Same address. We're small enough that there's no separate inbox for this yet. If that changes, this page will say so.

**CTA:** [support@fbx1.com](mailto:support@fbx1.com)

---

## 5. Changelog — `/changelog`

**Meta title:** Changelog | CostFlow
**Meta description:** What's shipped, in the order it shipped.

### Page copy

**Eyebrow:** Changelog

**H1:** What's new.

**Lead:** A running log of what changed in CostFlow, newest first. No marketing spin, just what shipped.

**Body (intro, sits above the entry list):**

We're in beta, so this moves fast and sometimes backward. We ship things, learn they're wrong, and change them. If a change affects your reports or your data, we'll say so here, and for anything that actually matters, email you directly too.

**Entry format (template for engineering/marketing to fill in as things ship):**

```
### YYYY-MM-DD
**[Added / Changed / Fixed]** — one-line description in plain language.
Longer explanation if it needs one: what changed, why, and whether anyone needs to do anything about it.
```

_(Note: I did not invent dated changelog entries. A changelog is a factual record; making up "shipped on this date" entries would be fabricating history, not writing marketing copy. Seed this page with real entries once someone owns pulling them from actual releases. The format above is ready to use.)_

---

## 6. Blog — `/blog`

**Meta title:** Blog | CostFlow
**Meta description:** Notes on workflow friction, pricing methodology, and what we're building.

### Page copy

**Eyebrow:** Blog

**H1:** Notes from building CostFlow.

**Lead:** Writing about the problem we're solving, how the pricing methodology actually works, and what we get wrong along the way.

**Body (index intro, sits above the post list):**

This is where the longer version of things lives: the reasoning behind a confidence tier, why we priced overdue work the way we did, what changed and why. If you want the short version, the product itself is the short version.

**Suggested first topics** _(not written yet, flagged as planned rather than published, per your instruction not to fabricate content)_:

- "Why every friction number is a range, not a point estimate." The actual reasoning behind expected-value-with-a-range instead of a single confident-looking number.
- "What we mean by 'unpriced,' and why we'd rather show nothing than guess." The confidence-tier system and the decision to leave things unpriced instead of inventing an assumption.
- "The first version of CostFlow's cost model was wrong. Here's what changed." An honest post-mortem once there's something real to write about.
- "Reading a Jira board like a queueing problem." The mental model behind treating "waiting" and "stalled" as distinct, priceable states.

**CTA (empty state, if the blog has zero posts live):** Nothing published yet. Check back soon, or [see the product](../) in the meantime.

---

## 7. Careers — `/careers`

**Meta title:** Careers | CostFlow
**Meta description:** Not actively hiring right now. Here's what we'd look for when that changes.

### Page copy

**Eyebrow:** Careers

**H1:** Not hiring right now, but here's what matters to us when we are.

**Lead:** CostFlow is a small team building a focused product during a free beta. There's nothing open at the moment.

**Body:**

We'd rather tell you that plainly than leave a "Careers" link pointing at an empty page or a stale form. When we do open something up, we'll post it here first.

**What we'd look for, when we're hiring:**

People who'd rather ship something small and correct than something big and impressive-sounding. People who read the actual formula behind a number before trusting it. People who are fine saying "I don't know" and then going and finding out.

**In the meantime:**

If you're interested in what we're building and want to keep half an eye on this page, that's genuinely the best way to know first. We don't have a separate talent-network signup, and we're not going to build one just to collect emails.

**CTA:** Questions anyway? [support@fbx1.com](mailto:support@fbx1.com)

---

## 8. Docs — `/docs`

**Meta title:** Documentation | CostFlow
**Meta description:** How to connect your tracker, read your report, and understand the numbers.

### Page copy

**Eyebrow:** Documentation

**H1:** Everything you need to run CostFlow, in one place.

**Lead:** This isn't a developer API reference. CostFlow doesn't have a public API yet. It's the plain-language version of how the product actually works.

**Section directory:**

**Getting started**
Connecting Jira or ClickUp, choosing what to import, and running your first report: the same flow the product walks you through, written out in case you want to read ahead.

**Connecting Jira**
Where to generate an API token, what scopes it needs, and what CostFlow does and doesn't do with it once it's connected.

**Connecting ClickUp**
Same idea, ClickUp's version: token generation, list/space selection, and the read-only guarantee.

**Mapping statuses and roles**
How your board's statuses map to CostFlow's stages (active, queue, stalled, done), and how team members map to cost categories. Why this step exists: nothing gets priced on a mapping you didn't confirm yourself.

**Understanding your report**
What a confidence tier (A/B/C) actually means, how a range and an expected value are calculated, and how to open any number all the way down to its formula and inputs.

**Assumptions and rates**
Where hourly rates, time-allocation percentages, and cost-factor multipliers come from, which ones are vendor-suggested versus ones you've confirmed, and how to change them.

**Exporting your data**
Every report can be exported as raw JSON or printed to PDF. What's in the export, and what it's useful for: audits, sharing outside CostFlow, your own analysis.

**FAQ**
Short answers to the questions that come up most. See the standalone FAQ page for the full list.

**CTA:** Still stuck? [support@fbx1.com](mailto:support@fbx1.com). A real person answers.

---

## 9. Cookies — `/cookies`

**Meta title:** Cookie Policy | CostFlow
**Meta description:** CostFlow uses one cookie, and it's not for tracking you.

### Page copy

**Eyebrow:** Cookies

**H1:** We use exactly one kind of cookie, and it's not for ads.

**Lead:** CostFlow sets a single session cookie so you stay logged in. That's the entire list.

**Body:**

There's no analytics cookie, no advertising cookie, no third-party tracking pixel, and no cross-site tracking of any kind. The page you're on right now was built under a content policy that blocks third-party scripts outright, so there's nowhere for a tracker to run even if we wanted one.

**The one cookie we do set:**

| Cookie       | Purpose                              | Type               | Expiry                 |
| ------------ | ------------------------------------ | ------------------ | ---------------------- |
| `cf_session` | Keeps you signed in between requests | Strictly necessary | Session / until logout |

Because this cookie is strictly necessary for the product to function, and it's not used for tracking, advertising, or analytics, CostFlow doesn't show a cookie-consent banner. There's nothing optional to consent to.

**If that changes:**

If we ever add a cookie that isn't strictly necessary, this page, and a real consent banner, will exist before that cookie does, not after.

**CTA:** Questions? [support@fbx1.com](mailto:support@fbx1.com)

---

## 10. Data Processing / Subprocessors — `/dpa` (or `/subprocessors`)

**Meta title:** Subprocessors | CostFlow
**Meta description:** The infrastructure and services CostFlow relies on to run.

### Page copy

**Eyebrow:** Data processing

**H1:** Who else touches your data, and why.

**Lead:** CostFlow is a small product with a short, honest list of infrastructure it depends on. Here's what's real today.

**Body:**

**Identity and sign-in**
Authentication runs through Auth0 (an Okta product) for single sign-on. Auth0 handles your login session; it doesn't see your Jira or ClickUp data.

**Hosting and infrastructure**
CostFlow's application and database run on Railway. Railway hosts the infrastructure; it doesn't have a separate relationship with your imported work-tracking data beyond storing it encrypted on our behalf.

**What we don't have (yet):**
No third-party analytics processor, no marketing/CRM platform connected to product data, no data broker relationships, no resale of any data to anyone, for any reason.

**A note on completeness:**

This list reflects what's actually confirmed in CostFlow's architecture today. As the product grows, email delivery and error monitoring are the likely next additions, and this page will be updated before those services touch any customer data, not after. If your legal or security team needs a formal Data Processing Agreement ahead of a vendor review, email [support@fbx1.com](mailto:support@fbx1.com) and we'll work through it directly.

---

## 11. Accessibility — `/accessibility`

**Meta title:** Accessibility | CostFlow
**Meta description:** How CostFlow approaches accessibility, and how to tell us where it falls short.

### Page copy

**Eyebrow:** Accessibility

**H1:** Built to work with a keyboard, a screen reader, and normal eyesight, not just a mouse and 20/20 vision.

**Lead:** CostFlow hasn't gone through a formal accessibility audit. Here's what's actually true about how it's built, and where to tell us when it isn't enough.

**Body:**

Every interactive element is reachable by keyboard, in the order you'd expect visually. Every page has a skip-to-content link for anyone tabbing past the header on every single page load. Focus states are visible; you can see where you are without a mouse. Text and background colors are chosen for contrast, not just for looking right on one designer's monitor.

We didn't add an accessibility overlay widget. Most of them cause more problems than they fix. We'd rather build the real thing into the product than paper over gaps with a script.

**Where we're honest about the gap:**

We haven't run a full WCAG audit, and we're not going to claim a compliance level we haven't verified. If you use assistive technology and something in CostFlow doesn't work the way it should, that's exactly the feedback we need: not a hypothetical, an actual report from someone hitting the actual problem.

**Report an issue:** [support@fbx1.com](mailto:support@fbx1.com). Tell us the page, what you were trying to do, and what happened instead. We'll get back to you and fix what we can.

---

## 12. Sitemap (human-readable) — `/sitemap`

**Meta title:** Sitemap | CostFlow
**Meta description:** Every page on CostFlow, in one list.

### Page copy

**Eyebrow:** Sitemap

**H1:** Everything on this site.

**Body (grouped list):**

**Product**

- [Home](/): what CostFlow does and why
- [Pricing](/pricing): free during beta
- [Security](/security): how your data and credentials are handled
- [Sample report](/demo): a real report, no signup
- [Try it live](/try): a random generated company, run through the real engine

**Company**

- [About](/about): who's building this
- [Contact](/contact): one email address, real replies
- [Careers](/careers): nothing open right now
- [Blog](/blog): notes on the product and the problem

**Resources**

- [Documentation](/docs): how to connect, map, and read your report
- [Changelog](/changelog): what shipped, in order
- [FAQ](/faq): short answers to common questions

**Legal**

- [Terms of Service](/terms)
- [Privacy](/privacy)
- [Cookie Policy](/cookies)
- [Subprocessors](/dpa)
- [Accessibility](/accessibility)

---

## 13. Standalone FAQ — `/faq`

**Meta title:** FAQ | CostFlow
**Meta description:** Answers to the questions that come up most before and after connecting.

### Page copy

**Eyebrow:** FAQ

**H1:** Questions people actually ask us.

**(Mostly reused from the landing page; the first answer below now needs to change on the live site too, see the note at the bottom of this doc):**

**Is it really free? What's the catch?**
No catch. The Limited plan is free, permanently, not just for a trial window. No credit card to start. Upgrade to Pro or Enterprise only when the caps actually get in your way.

**Will you change anything in my Jira or ClickUp?**
Never. CostFlow connects with a personal API token and only reads. No comments, no status changes, nothing written back.

**How are the numbers calculated?**
From your imported work items and the rates you confirm. Every figure drills down to its formula and inputs. Open the sample report to see exactly how.

**What about privacy and my data?**
Credentials are encrypted and individuals are pseudonymized before analysis. You can export or permanently delete everything at any time. See [Privacy](/privacy) or email [support@fbx1.com](mailto:support@fbx1.com).

**Which tools do you support?**
Jira and ClickUp today. Monday, Asana, and CSV import are next.

**(New, for the pages this batch adds):**

**Is there a public API?**
Not yet. You can export any report as raw JSON or a PDF right now. A documented API for pulling data programmatically is on the list, not built.

**Do you sell or share my data with anyone?**
No. See [Security](/security) and [Subprocessors](/dpa) for exactly who touches infrastructure and what they do and don't see.

**What happens to my data if I stop using CostFlow?**
Delete your workspace or organization whenever you want, and it's actually gone. Deletion cascades to every report derived from it. We don't keep a backup "just in case."

**I run a security review before letting any vendor near our Jira. Where do I start?**
[Security](/security) and [Subprocessors](/dpa) cover the substance. If you need something specific for a vendor questionnaire, email [support@fbx1.com](mailto:support@fbx1.com) directly. We'll work through it with you rather than making you guess from a page.

---

## Footer — updated structure (copy only)

Four columns, replacing the current single row of three links:

**Product**
Pricing · Security · Sample report · Try it live

**Company**
About · Blog · Careers · Contact

**Resources**
Documentation · Changelog · FAQ

**Legal**
Terms · Privacy · Cookies · Subprocessors · Accessibility

Bottom row (unchanged from today, keep it): brand mark, "CostFlow is an FBX1 product," support email.

_(No social links included. There's nothing real to link to yet. An empty social icon row that points at dead or unused accounts is worse than no row. Add it when there's an actual account behind it.)_

---

## What I didn't write, and why

- **No changelog entries with real dates.** A changelog is a historical record. Fabricated entries would misrepresent what actually shipped and when.
- **No blog posts, only planned topics clearly marked as unwritten.** A published-looking post that was never written is a fabricated record.
- **No founder names, headcount, office location, or funding status on the About page.** You asked for FBX1-as-a-brand framing without company or founder specifics, and that's what's here: mission and voice, no invented biography.
- **No compliance badges (SOC 2, ISO 27001, etc.) anywhere.** None of those are real yet. The Security and Accessibility pages say so directly instead of implying otherwise.
- **Subprocessor list limited to Auth0 and Railway.** Those are the two pieces of infrastructure I could actually confirm from the codebase and commit history. I didn't guess at an email provider, error-monitoring tool, or database vendor beyond what's verifiable.

## One live-code inconsistency this creates

Pricing is now real (Limited $0, Pro $20/user, Enterprise $100/user), but the actual landing page (`landing.ts`, already shipped) still says "free while in beta... paid plans come later" in both the hero trust line and the FAQ. That's live copy, not part of this doc's scope, so I didn't touch it here. But it now contradicts the pricing above and should get updated once `/pricing` actually ships, or sooner if that's confusing anyone signing up in the meantime.
