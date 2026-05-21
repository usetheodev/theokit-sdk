# D160 — Personality presets ride the `SystemPromptResolver` hook (no new core changes)

**Date:** 2026-05-20
**Status:** Accepted

## Decision

Personality activation overlays the preset body onto the resolved system
prompt at the existing `SystemPromptResolver` integration point. No new
hook surface, no new agent-loop seam, no new event type. The runtime path
is: `LocalAgent.resolveSystemPromptForSend` → resolve user base prompt →
`applyPersonalityOverlay(base)` → concatenated string sent to the LLM.

## Rationale

The `SystemPromptResolver` (`SystemPromptContext` → string|Promise<string>)
already runs per send, sees `agentId`, and supports awaited base prompts.
Adding a new hook for personality would be parallel infrastructure for a
feature that already has a load-bearing seam. Hermes #26 calls this "the
light shim over a primitive that already exists" — the audit confirmed
the primitive is `SystemPromptResolver`.

## Consequences

- **Enables:** zero changes to agent-loop core; personality is purely
  additive at the system-prompt boundary.
- **Constrains:** future per-personality system-message injection (e.g.,
  conversation tools that wrap turns) would need a different seam — not
  this one.
