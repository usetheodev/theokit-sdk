# D88 — Repair does NOT do fuzzy tool name matching

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D87, plan `agent-core-loop-completion-plan.md`

## Decision

`repairToolCall` resolves provider-emitted tool names only via:

- Exact match (`registry.has(name)`).
- Case-insensitive match (only).

No Levenshtein distance, no edit-distance heuristics, no fuzzy aliases.
When the model emits `"file_writter"` and the registry has `"write_file"`,
the call falls through to the unknown-tool error path with the full
available list returned to the LLM.

## Rationale

Fuzzy matching silently masks real bugs:

- Model hallucinates a typo → fuzzy maps to the wrong real tool.
- Two similar names diverge in semantics → fuzzy picks one, caller
  thinks the other was invoked.

Hermes explicitly rejects fuzzy match (`tool-call-failure-recovery.md:
288-291`). The SDK inherits the posture: errors visible, not silenced.

## Consequences

- **Enables:** model self-correction via "Unknown tool: X. Available: A, B,
  C" feedback. Type errors and hallucinations stay distinguishable.
- **Constrains:** the model must emit a name modulo case. A real typo
  results in one wasted iteration where the LLM retries with the correct
  name.
