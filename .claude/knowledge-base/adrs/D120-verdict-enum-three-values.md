# D120 — Verdict is a closed enum: `done | continue | skipped`

**Date:** 2026-05-19
**Status:** Accepted

## Decision

`Verdict` is a TypeScript literal union with exactly three values:
- `"done"` — goal satisfied
- `"continue"` — keep working
- `"skipped"` — not applicable (e.g., already true)

`parseVerdict(text)` matches prefixes `DONE:`, `CONTINUE:`, `SKIPPED:`
strictly (case-sensitive). Anything else returns `{ verdict: "continue",
parseFailed: true }` (fail-safe, see ADR D121).

## Rationale

A free-form `verdict: string` would let weak judges produce "verdict
varies" — `"almost done"`, `"mostly"`, `"yes"`. Parse-failure detection
becomes impossible. The strict three-value enum forces consistency at
the judge prompt level ("Respond with EXACTLY one of: DONE: / CONTINUE:
/ SKIPPED:") and gives the runUntil loop a finite state machine.

Hermes uses the same three verdicts in `goals.py:judge_goal`.

## Consequences

- **Enables:** TS exhaustive switch in `runUntilImpl`. Forgetting a
  verdict is a compile error.
- **Constrains:** adding a fourth verdict (e.g., `"escalate"`) is a
  breaking change for consumers that exhaustively handle the union.
  By design — silent extensions hide bugs.
