# Partner findings memo — <partner-code>, <date>

Operator: ______ · Commit: ______ · Dataset: <n items / n events, values-free>

> One entry per finding, under exactly one category. No raw actor values, no
> customer-identifying content beyond the partner code. This memo never leaves
> `partner-runs/<code>/notes/` except as an anonymized summary approved for
> the M1 findings review.

## Finding entry format (copy per finding)

```
### <category-prefix>-<n>: <one-line title>
- Severity: P0 / P1 / P2 / P3
- Evidence: <what happened — command, output excerpt (values-free), pass #>
- Customer impact: <what it meant in the session>
- Proposed response: <smallest honest response>
- Fix: now / later / never
- Generalizes beyond this partner: yes / no / unknown — <why>
```

## 1. Product defects (it misbehaved)

## 2. Missing product capabilities (it honestly can't yet)

## 3. Partner data-quality problems (their data, not our code)

## 4. Partner-specific configuration (needed here, not generalizable)

## 5. Unclear business assumptions (nobody could answer in the room)

## 6. UX / operational friction (worked, but painfully)

## 7. Useful insights successfully produced (what landed)

## 8. Insights expected but honestly not producible (and what we said instead)

---

## Session verdicts (fill at the end)

- Did the external CSV fit the canonical model? ______
- Manual mapping effort (wall-clock, # of decisions): ______
- Were diagnostics understandable to a non-engineer? ______
- Were all assumptions gatherable in one live session? ______
- Was the cost narrative credible to the partner (their words): ______
- Would they pay for this artifact/session? Evidence: ______
- Recommendation: continue / revise / stop — ______
