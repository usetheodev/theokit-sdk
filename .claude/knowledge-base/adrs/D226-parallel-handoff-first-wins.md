# D226 — Parallel handoff tools in one LLM turn: first wins; others rejected

**Date:** 2026-05-22
**Status:** Accepted

## Decision

When the LLM emits multiple `tool_use` in the same response:

- The **first** `transfer_to_*` tool (positional order) wins; runtime
  dispatches to that receiver.
- Subsequent handoff tools in the same response receive `tool_error:
  multiple_handoff_in_turn` so the LLM sees the conflict.
- Non-handoff tools in the same response are **vetoed** (sender's loop
  ends BEFORE executing them — the receiver picks up).

## Rationale

- Modern LLMs (Claude 3.5+, gpt-4o, Llama 3.1+) can emit multiple `tool_use`
  in one response. Without a guard, dispatch race is undefined.
- "First wins" is deterministic + matches OpenAI Agents.

## Consequences

- Enables deterministic resolution under parallel emission.
- Constrains: callers who want "do both" must use `Agent.batch` or
  sequential turns; documented in `examples/handoffs/README.md`.
