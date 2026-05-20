# D142 — Memory adapters expose a dual surface

**Date:** 2026-05-20
**Status:** Accepted

## Decision

Adapters expose memory via TWO surfaces simultaneously:

1. **API direta:** `agent.memory.write(content, ctx)` /
   `agent.memory.recall(query, ctx, k)` / `agent.memory.delete(id)` —
   caller-controlled, typed, deterministic.
2. **LLM-driven:** `adapter.getToolSchemas()` returns OpenAI-format
   function-calling schemas (`memory_write`, `memory_recall`,
   `memory_history` for Mem0). The agent loop offers these to the
   LLM as callable tools.

Both backed by the same adapter — no duplication.

## Rationale

Hermes does only (b) — tool-driven. We add (a) because TS consumers
expect typed methods (Mastra / Vercel AI ergonomics). Eval and
training-data scripts need deterministic write/recall without
depending on LLM tool-use heuristics.

The two surfaces share the same adapter implementation:
`handleToolCall` internally delegates to the same `write`/`recall`
methods that the direct API calls.

## Consequences

- **Enables:** chat-assistant flows leverage tool-driven memory
  automatically; eval scripts call the direct API for reproducibility.
- **Constrains:** adapters MUST implement both. `capabilities.toolSchemas`
  defaults to `true` for all three shipped adapters; an adapter that
  can't expose schemas declares `toolSchemas: false`.
