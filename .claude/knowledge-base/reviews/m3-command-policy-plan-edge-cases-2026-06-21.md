# Edge Case Review — m3-command-policy (PLAN cycle)

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m3-command-policy-plan.md
Tasks analyzed: 2 (T1.1 policy layer, T2.1 export/docs)
Edge cases found: 2 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 1)

## Boundary map
All functions pure. Live edge family: array composition boundaries (empty list, first-deny-wins ordering). Composes M3-2 (never-throw). No I/O.

## MUST FIX
(none — empty-list + deny-wins are ADR D1/D3 + T1.1 TDD; composition tested against M3-2.)

## SHOULD TEST

### EC-1: first-deny-wins ordering — a denier BEFORE an allower returns the denier's reason, and an allower before a denier still reaches the denier
- **Affected task:** T1.1
- **Family:** State
- **Scenario:** `commandDenialReason` must return the FIRST non-null reason. Test both orders: [denyAll, allowAll] → denyAll's reason; [allowAll, denyCatastrophic] on "rm -rf /" → denyCatastrophic's reason (iteration continues past the allower).
- **Suggested test:** `test_first_deny_wins_both_orders` — assert order-correctness with a synthetic always-deny policy `() => "X"`.

## DOCUMENT

### EC-2: a CommandPolicy may be a custom consumer predicate
- **Accepted risk:** `CommandPolicy` is an open type — consumers can pass their own `(cmd) => reason|null` (e.g. an allowlist). `denyCatastrophicCommands()` is just the SDK-provided default. Documented.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 2 | 0 | EC-1 | EC-2 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (1 SHOULD TEST — first-deny-wins both orders — fold into T1.1 TDD; no MUST FIX)
