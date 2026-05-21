# D187 — `CredentialPool` is a no-op for `authType: "none"` providers + one-shot warn

**Date:** 2026-05-21
**Status:** Accepted

## Decision

When `resolveProviderChain({ apiKeys: { ollama: [...] } })` is called
against a profile with `authType: "none"`, the router:

1. Detects the (profile.authType === "none" AND `apiKeys` populated)
   condition BEFORE the standard pool-construction branch.
2. Emits a one-shot stderr warning (keyed by provider name):
   `provider "ollama" has authType: "none" — apiKeys ignored (no auth required for local runtime).`
3. Builds a single (non-pool) transport via `selectTransport(profile, sentinel)`.

The warning fires at most once per provider per process. Re-running
`resolveProviderChain` for the same `(name, apiKeys)` shape stays silent.

A test-only `_resetNoAuthApiKeyWarnings()` helper resets the warn set
between vitest runs.

## Rationale

- **Pool-of-sentinels is semantically meaningless.** Building a
  `CredentialPool` with `[sentinel, sentinel, sentinel]` against a
  runtime that ignores auth wastes memory + clutters cooldown logs.
- **Silent no-op would hide user mistakes.** The user typed
  `apiKeys: { ollama: [...] }` intentionally; surfacing the discrepancy
  saves debugging time.
- **One-shot suppression matches our other warn patterns**
  (`provider-discovery alias collision`, `credential-pool: unknown provider`).
- **Edge-case review EC-C MUST FIX absorbed.** The plan's edge-case
  review flagged this as an under-specified MUST FIX. This ADR + the
  implementation in `buildClient` close the gap.

Alternatives rejected:

- **Hard error.** Too strict — user might be testing fallback paths
  and a future provider may shift `authType` from `"none"` to
  `"api_key"`. Warn is enough.
- **Silently drop the keys.** Hides genuine config mistakes (typo'd
  `OLLAMA_API_KEY` env var name, etc.).

## Consequences

- **Enables:** Defensive guard against meaningless config without
  breaking working code.
- **Constrains:** The warn helper is global state in router.ts —
  test isolation requires the `_resetNoAuthApiKeyWarnings()` call in
  `beforeEach`. Standard pattern in this codebase (mirror of
  `_resetCredentialPoolWarnings`).
- **Carries forward:** LM Studio (D188) and llama.cpp (D189) inherit
  the same behavior automatically since they share `authType: "none"`.
