# Session

Current state only, overwritten not appended. Durable knowledge → `CLAUDE.md`; what is
true of the shipped product → `docs/02-current-state.md`.

## Objective

- No active implementation work. A launch-readiness audit produced a ranked defect
  queue; the trust and explanation-layer items shipped. The remainder awaits a pick.

## State

- Branch `main`, clean, level with `origin/main`. `pnpm check` green.

## Next

- Awaiting a pick from the audit queue. Highest-ranked unstarted code item is R15
  (refuse sign-in on `email_verified === false`), then adding Settings and Organization
  to the signed-in nav (`packages/ui/src/html.ts:487`, `:492`) — both unreachable
  before a first run, while `/docs` tells customers to change setup there.
- The audit lives only in chat. Its two most serious findings are now R14 and R15;
  promote anything else durable to `docs/06-known-risks.md` rather than leaving it here.

## Blockers

- `COSTFLOW_ENV`'s live Railway value is unknown, and a boot assertion cannot be written
  safely without it. Behaviour documented in `08-admin.md`; the value is operator-held.
- R14 and R1 are operator-owned and block nothing in code.

## Notes

<!-- manual -->
<!-- Human-authored. Never rewritten or pruned by Update Session. -->
