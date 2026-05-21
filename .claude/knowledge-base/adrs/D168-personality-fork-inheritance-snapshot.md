# D168 — Forks inherit the parent's active personality as a slug snapshot (NOT a live reference)

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`Agent.fork(...)` captures the parent's active personality slug ONCE at
fork-construction time and propagates it via `AsyncLocalStorage`
(`internal/personality/context.ts`). The fork's `applyPersonalityOverlay`
and `resolveActivePersonalityPreset` read from the ALS frame when
inside a fork scope, falling back to the agent's own `PersonalityStore`
otherwise. Calling `usePersonality(...)` inside a fork emits a one-shot
warning and returns `null` without state change.

**EC-A invariant:** the captured slug is a **string** (primitive),
copied into the ALS context object. If the parent later calls
`usePersonality("Y")` while the fork is still running, the fork's
voice remains "X" (its construction-time slug).

## Rationale

Mirrors the D131 credential-pool ALS pattern. Snapshot semantics make
fork behaviour deterministic: a fork's voice is decided at fork-time
and immune to parent mid-flight mutation. The no-op-with-warning on
in-fork `usePersonality` enforces this — a fork that wants a different
voice should be created with the right parent state.

## Consequences

- **Enables:** parallel fan-outs (e.g., `Agent.batch`) with parent's
  current voice; no race between fork init and parent switch.
- **Constrains:** forks cannot dynamically change voice mid-run. Spawn
  a fresh fork instead.
