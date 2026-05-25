# D313 — `providerError` is a getter aliasing `metadata.raw` (no new field)

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 3, T3.2

## Decision

The handoff requested a top-level `providerError?: unknown` on `AgentRunError`. We expose it as a `get providerError()` returning `this.metadata?.raw`. The raw response body continues to live at `metadata.raw` — single source of truth.

## Rationale

- **Single source of truth.** Duplicating raw body as a top-level field would risk drift when one is updated and the other isn't.
- **Redaction invariant.** `metadata.raw` flows through `truncateRaw` + `redactSecrets` (D68). The getter inherits the redaction automatically.
- **Anti-leak invariant.** `.message` MUST NOT contain raw body content (security). The getter exposes the redacted version for callers that want to inspect; `.message` stays clean.

## Alternatives considered

- **Add `raw` as a top-level field** — rejected. Existing `metadata.raw` is the canonical location. Adding a top-level field would force every mapper to set both, with sync risk.

## Consequences

- Consumers use `err.providerError` for ergonomics; `err.metadata?.raw` is the underlying spec form.
- Test `test_message_never_leaks_providerError` pins the anti-leak invariant.
