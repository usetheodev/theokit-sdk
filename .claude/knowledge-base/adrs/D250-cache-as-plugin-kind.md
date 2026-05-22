# D250 — Cache is a Plugin (`kind: "cache"`), not an Agent wrapper

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Cache adds a new discriminator `"cache"` to the `Plugin` discriminated union (D98). Plugin exposes `pre_user_send` (lookup) and `post_assistant_reply` (store) hook handlers (D145).

## Rationale

Hooks already exist for intercepting prompt before LLM and capturing response after. Plugin shape is non-invasive, composable (multiple plugins coexist), and per-agent (avoids LangChain Python's global state anti-pattern).

## Consequences

- Cache is per-Agent. Multi-tenant resolved by namespace (D253), not by global state.
- Adding "cache" to Plugin union is additive (not breaking).
- Tests can construct cache+plugin in isolation.
