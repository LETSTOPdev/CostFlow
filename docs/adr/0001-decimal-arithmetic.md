# ADR-0001 — Exact decimal arithmetic via decimal.js

**Status**: accepted (M0) · **Binds**: NFR-3, doc 08 stack table

## Decision

All monetary computation uses a single configured `Decimal` clone
(decimal.js, precision 34, ROUND_HALF_EVEN), exported from
`packages/cost-engine/src/decimal.ts`. Money at rest (domain types, run
artifacts, JSON files) is always a normalized decimal *string*; a bare `number`
holding money is a review-blocking defect. Rounding to display precision
happens exactly once, in the reporting renderer.

## Why

- NFR-3 mandates no binary floats in currency paths; JS `number` is a binary
  float. decimal.js is the boring, battle-tested option (A6) with arbitrary
  precision and explicit rounding modes.
- One configured clone, imported everywhere, pins precision/rounding so results
  cannot vary by call site — a determinism (NFR-1) requirement, not a style one.
- Strings at rest keep the pure packages dependency-free (`domain` declares
  `DecimalString`) and make artifacts portable and diffable.

## Addendum (2026-07-20, Slice 1.1 — R-02/R-03)

Two rules this ADR implied but did not state, now explicit after both were
violated in slice 1:

1. **Canonical serialization is `toFixed()`, never `toString()`.** decimal.js
   `toString()` switches to exponential notation at ≥1e21; a canonical decimal
   string must never contain an exponent. Enforced by a property test
   (serialization never matches `/e/i`, round-trips exactly).
2. **Display formatting is part of the engine's monetary surface.**
   `formatWholeMoney` (whole units, ROUND_HALF_EVEN via the pinned class,
   locale-free digit grouping) lives in `cost-engine` and is the ONLY way money
   becomes human-readable text. Consumers — reporting today, exports later —
   may never parse, round, or group decimal strings themselves. The slice-1
   hand-rolled renderer (sign bug on negatives, half-up rounding, crash on
   large values) is the cautionary tale.

## Alternatives rejected

- **Integer minor units (cents)**: breaks on fractional assumption math
  (0.3 attention-hours × rates) without reintroducing scaling conventions.
- **big.js / bignumber.js**: same family; decimal.js has the richest rounding
  semantics for later models. Any would do — picking one and pinning it is the
  actual decision.
- **Native BigInt fixed-point**: hand-rolled scaling logic is exactly the
  bug-prone cleverness A6 forbids.
