# D260 — Lookup at `pre_user_send`; store at `post_assistant_reply`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Plugin handler `pre_user_send` attempts lookup; on hit, returns `{ shortCircuit: true, response }` to skip the LLM call. Handler `post_assistant_reply` stores the response (KV + vector) for future lookups.

## Rationale

Hook points already exist (D145). Pre-LLM lookup avoids wasted tokens + latency. Post-reply store guarantees we only cache complete responses (not partial streams).

## Consequences

- Agent loop respects short-circuit flag — does NOT call LLM on cache hit.
- Tests verify `agent.send` resolves without provider fetch on hit.
- Cache hits faster than LLM (~10ms vs 500ms+).
