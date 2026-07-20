# CostFlow — Product Foundation

**Status: M0 in progress.** The first vertical slice is implemented (CSV → canonical →
F2 aging detector → cost model → formula trace → ranked CLI report, golden-tested).
See [docs/09-implementation-log.md](docs/09-implementation-log.md). M1+ is not authorized.

Quick start: `pnpm install && pnpm check`, then
`pnpm costflow analyze --csv tools/golden/fixtures/demo-ops.csv --mapping tools/golden/fixtures/mapping.json --assumptions tools/golden/fixtures/assumptions.json`

CostFlow is a Business Friction Intelligence platform: it translates organizational
friction (delays, rework, handoffs, blockers) into financial impact, so executives can
prioritize work based on money instead of urgency.

This repository currently contains only the product and architecture foundation
documents. Read them in order:

| Doc                                                                                   | Contents                                                                                                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [00-vision-scope-mvp.md](docs/00-vision-scope-mvp.md)                                 | Product vision, scope, MVP definition                                                                                           |
| [01-personas-journeys.md](docs/01-personas-journeys.md)                               | Core user personas, user journeys                                                                                               |
| [02-domain-model.md](docs/02-domain-model.md)                                         | Internal domain model, friction taxonomy, delay-cost taxonomy                                                                   |
| [03-cost-engine.md](docs/03-cost-engine.md)                                           | Cost Engine philosophy, explainability philosophy                                                                               |
| [04-requirements.md](docs/04-requirements.md)                                         | Functional and non-functional requirements                                                                                      |
| [05-architecture.md](docs/05-architecture.md)                                         | Repository structure, module boundaries, integrations strategy, AI responsibilities, architecture principles                    |
| [06-constraints-open-questions-risks.md](docs/06-constraints-open-questions-risks.md) | Things that must never be built, open architectural questions, existential risks                                                |
| [07-decision-engine.md](docs/07-decision-engine.md)                                   | The decision layer: diagnostic (root cause) engine, recommendation engine, simulation engine, Decision object, five-year vision |
| [08-implementation-roadmap.md](docs/08-implementation-roadmap.md)                     | Phase 1 implementation roadmap: milestones M0–M4, stack, standards, testing, CI/CD, security, deferred work                     |
| [09-implementation-log.md](docs/09-implementation-log.md)                             | Running implementation log: M0 slice 1 checklist, decisions D-1…D-9, verification results                                       |
| [10-engineering-review.md](docs/10-engineering-review.md)                             | Staff-engineer review of slice 1: verified defects R-01…R-20, decision verdicts, re-scoped next slices                          |

## The three non-negotiable decisions

1. **Internal domain model first.** CostFlow is built around a canonical model of work,
   friction, and cost. Monday.com, Jira, ClickUp, HubSpot, and CSV are all just
   providers that map into it. No provider concept may leak into the core.
2. **CSV import is a first-class citizen.** The MVP delivers full value from a single
   CSV upload, with zero integrations. Live integrations come only after product-market fit.
3. **Every number is explainable.** No cost figure is ever shown without a traceable
   formula, its inputs, and the assumptions behind it. AI never invents numbers;
   the deterministic Cost Engine computes them.

## Where this foundation deliberately disagrees with the original brief

These are argued in detail in the docs, summarized here for honesty:

- **Point estimates are a trap.** We show cost _ranges_ with named assumptions, not
  single dollar figures. A single number invites a credibility fight with the CFO
  that we lose. (See 03-cost-engine.md)
- **Precision is not the product; ranking is.** The product wins if the _ordering_
  of frictions by cost is right and defensible, even when the absolute dollars are
  ±40%. (See 03-cost-engine.md)
- **"FBX1" should stay an internal codename** until there is an engine worth
  branding. Marketing an engine before it exists creates an expectation of AI magic
  that conflicts with our explainability positioning. (See 06, Open Questions)
- **Individual-level cost attribution is banned**, even though it is technically
  trivial and customers will ask for it. It converts the product into employee
  surveillance, poisons the data source (people will game statuses), and blocks
  enterprise deals in most of Europe. (See 06, Never Implement)
