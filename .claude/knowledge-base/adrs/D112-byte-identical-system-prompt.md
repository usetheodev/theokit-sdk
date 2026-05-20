# D112 — Fork inherits parent's system prompt byte-identical (cache hit)

**Date:** 2026-05-19
**Status:** Accepted

## Decision

`forkAgentImpl` sets `fork.options.systemPrompt = parent.options.systemPrompt`
by default. Override is available (`ForkOptions.systemPrompt`) but the
JSDoc explicitly notes that overriding pays full cache-miss cost.

## Rationale

Anthropic and OpenAI cache system-prompt prefixes byte-by-byte. Hermes
measures 26% cost savings on Sonnet 4.5 when fork agents inherit the
parent's `_cached_system_prompt` field (issue #25322, PR #17276). A
fork that re-renders its own system prompt — even with a trivial
difference — invalidates the cache and pays full input price.

## Consequences

- **Enables:** fork is cheap. Curator/Kanban background work runs in
  the same cost envelope as a single extra send.
- **Constrains:** callers who need a different system prompt MUST pass
  it explicitly; the SDK doesn't infer "this fork needs a different
  prompt" automatically.
