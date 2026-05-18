# D68 — Canonical `redactSecrets` in `internal/security/redact.ts`

**Date:** 2026-05-18
**Status:** Accepted
**Related:** D69, D70, D71, D72, D73, plan `secret-redaction-discipline-plan.md`

## Decision

A single canonical secret-redaction module lives at
`packages/sdk/src/internal/security/redact.ts`. It exports `redactSecrets`,
`maskToken`, `addPattern`. A test-only helper `_resetForTests` is
exported from a sibling `_test-reset.ts` (intentionally not part of the
barrel). Every output boundary (errors, telemetry, transcripts,
migration logs) imports from `internal/security/index.js`.

The two pre-existing local impls — `internal/memory/types.ts` (3-pattern
regex) and `internal/runtime/fixture-responder.ts` (5-pattern array) —
became thin re-exports / local helpers that delegate to the canonical
module.

## Rationale

Pre-T0.2 there were 3 different pattern lists, all materially
under-cover compared to what real attacks ship with (Hermes `redact.py`
keeps ~30 patterns). Maintaining three lists meant every new credential
shape would need to land in three places, with no compiler enforcement
that they match. KISS + DRY: one list, one function, one snapshot of
env.

Sibling alternatives considered:

- *Per-callsite redactors* — rejected because every new sink needs its
  own audit; cross-cutting concern.
- *Central but invoked via dependency injection* — adds setup ceremony
  without buying anything since the module is pure.

## Consequences

- Enables `grep redactSecrets` to find every callsite for audit.
- Enables a CI gate (T1.5.2) that rejects new `console.log`/
  `appendFile`/`setAttribute` calls without `redactSecrets`.
- Constrains: every caller must import from `internal/security/` —
  rejected callers must be added to the no-unredacted-sink whitelist
  with rationale.
