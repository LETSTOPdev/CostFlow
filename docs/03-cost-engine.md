# 03 — Cost Engine Philosophy & Explainability Philosophy

The cost engine is the heart of the company. If executives trust its output, the
company can be very large; if they don't, nothing else matters. Every principle
here is downstream of that single fact.

## 1. Cost Engine Philosophy

### P1 — Deterministic, versioned, reproducible. No exceptions.

The engine is pure computation: `(canonical data, assumption set, model versions)
→ estimates`. Same inputs, same outputs, forever.

- **Why**: reproducibility is what lets a number survive an audit ("run 142,
  model v3, assumptions v7 — here is the derivation"), lets us A/B model
  improvements against history, and makes the trust-building interaction of J3
  ("change the rate, watch everything recompute") trivially cheap.
- **Hard consequence**: **no LLM anywhere in the numeric path.** AI may suggest
  mappings and draft narratives (doc 05); it may never produce, adjust, or
  "sanity-check-and-tweak" a number. A model that cannot reproduce its own output
  cannot be audited, and an unauditable number is a liability with a currency
  symbol.

### P2 — Ranges, not points. Confidence, not confidence theater.

Every estimate is `{low, expected, high}` plus a confidence tier (A/B/C) derived
mechanically from data quality (events vs. snapshot), assumption provenance
(customer-set vs. default), and model maturity.

- **Why**: "$147,230" reads as false precision and invites a fight about the
  fourth digit. "$120k–180k, expected ~$150k, confidence B" reads as honest
  modeling and moves the conversation to the ordering — which is the conversation
  we win. The precision of the display should never exceed the precision of the
  inputs.
- **Challenge accepted**: the brief implied "how much every delay costs" — a
  point-value framing. We are deliberately deviating. A point estimate is the
  fastest way to lose Rivka (P3 persona) and therefore the deal.

### P3 — The ranking is the product; absolute dollars are the medium.

The engine's true job is a defensible *ordering* of frictions and a roughly-right
*magnitude*. Decisions change when the ordering is right; they do not change
because $150k was really $137k.

- **Consequence for engineering priorities**: invest in whatever improves ordering
  stability (better data capability detection, conservative defaults, sensitivity
  visibility) before anything that improves decimal precision.
- **Consequence for the model**: when in doubt, be conservative. A number that is
  probably an underestimate and survives audit beats a bigger number that dies in
  one. Every model documents its bias direction ("this underestimates because…").

### P4 — Assumptions are customer-owned, first-class, and always visible.

The engine brings formulas; the customer brings the numbers that make them theirs
(rates, deal values, penalty terms).

> **Amended 2026-07-20** (implementation experience — doc 14 FS-3 applied to
> pricing modes). The original clause "defaults exist to avoid a cold start,
> loudly labeled, confidence capped" proved insufficient: a labeled vendor
> number is still a vendor number, and labels do not survive forwarding.
> Provenance is a ladder, not a boolean:
> `vendor-suggested → customer-accepted → customer-customized →
> customer-measured`. Every assumption carries its state. **Production
> reports price exclusively on customer-owned states** (accepted /
> customized / measured); an estimate that would touch any vendor-suggested
> load-bearing input is reported as a detected, time-denominated friction
> with the missing confirmation named — never partially priced. Vendor
> suggestions retain two legitimate homes: **explicit simulation mode**
> (prominently bannered, doc 07 N13 register, never the executive template)
> and **onboarding suggestion UX**, where actively accepting a suggested
> value converts its provenance to customer-accepted. The cold-start problem
> is solved by suggestions at input time, not by vendor-priced reports.

- **Why this is strategic, not just honest**: an executive cannot reject a number
  whose every input his own team supplied. Customer-owned assumptions convert
  "vendor's fantasy math" into "our model, operated by CostFlow." That reframing
  is the sale.

### P5 — Degrade honestly. Never fabricate.

Every cost model declares required inputs. Missing history → time-based models
don't run, and the UI says why. Missing value attribution → friction is shown
with time-denominated magnitude ("340 item-days waiting") and a prompt to attach
value — never a synthesized dollar figure.

- **Why**: one fabricated number, discovered once, retroactively poisons every
  real number we ever showed. Also creates a virtuous UX loop: what the customer
  must add to unlock more pricing is always explicit.

### P6 — Models are pluggable, versioned strategies.

One cost model per friction type, registered against the F×→C× contract (doc 02
§5), versioned independently. New model versions run side-by-side on historical
runs before promotion; old estimates keep citing the version that produced them.

- **Why**: cost models are where our IP compounds. We will improve them for a
  decade; the architecture must let a model evolve without invalidating history
  or requiring a migration of anything.

## 2. Explainability Philosophy

Explainability is not a feature ("show formula on click"). It is the load-bearing
trust mechanism, and it has an architectural cost we accept up front: **every
estimate persists its full derivation** (`formula_trace`), not just its result.

### E1 — Every number answers four questions, in one click

1. **What is this?** Plain-language claim: "Estimated cost of items waiting in
   'Contract Review' during March."
2. **How was it computed?** The formula, readable: `Σ (wait_days × daily_rate for
   role)` — rendered with the actual numbers substituted.
3. **What data went in?** The specific work items (drillable list), from which
   import batches.
4. **What was assumed?** The assumption set entries used, with provenance:
   "Blended rate $85/h — set by Maya, Jan 12" vs. "default (unconfirmed)".

If any of the four can't be answered, the number does not ship.

### E2 — Layered depth: headline → mechanics → audit

Daniel reads layer 1 (claim + range + trend). Maya reads layer 2 (formula +
items). Rivka reads layer 3 (full trace, versions, assumption history, export).
The UI never front-loads layer 3 — explainability must not make the product feel
like a spreadsheet — but layer 3 is always one more click, never a support ticket.

### E3 — Explanations are generated from the trace, not written about it

Narrative text (including AI-drafted insight prose, doc 05) is rendered *from*
the `formula_trace` — templated numbers come from the trace, and generated prose
may only reference quantities present in the trace. An explanation that could
drift from the actual computation is worse than none.

### E4 — Sensitivity is part of honesty

Where one assumption dominates an estimate, say so: "This estimate is mostly
driven by the blended rate; ±20% on the rate moves it ±19%." Cheap to compute
(re-run the pure engine with perturbed inputs), and it preempts the exact attack
an intelligent skeptic will mount. Post-MVP polish, but the pure-function design
makes it nearly free, which is another argument for P1.

### E5 — Uncertainty language is standardized

One vocabulary across product, exports, and marketing: "estimated", ranges,
confidence tiers with defined meanings. Marketing will want "CostFlow found $2M
in losses!" — exports must make stripping the uncertainty framing *harder* than
keeping it, because our customers' internal credibility is our credibility.

## 3. What the engine is NOT

- Not a forecasting system (MVP prices observed friction; projection beyond the
  simple scenario calculator comes later, and will be labeled as projection).
- Not an accounting system: estimates are decision-grade economics, never
  book-grade figures, and exports say so.
- Not a benchmark engine (yet): "vs. industry" claims require data we don't have
  and a legal design we haven't done. No fake benchmarks seeded from literature.
