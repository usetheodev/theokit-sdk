# D100 — `HookName` is a closed enum (8 fixed hooks)

**Date:** 2026-05-19
**Status:** Accepted

## Decision

`HookName` is a TS literal union over 8 hooks: `pre_tool_call`,
`post_tool_call`, `pre_llm_call`, `post_llm_call`, `on_session_start`,
`on_session_end`, `transform_tool_result`, `transform_llm_output`.

Plugins cannot register hooks with arbitrary names. Adding a hook is a
core decision + announcement + ADR.

## Rationale

Arbitrary hooks lead to "hook-of-hook" sprawl. Each hook is a contract
point with semantics (timing, return shape, ordering); arbitrary
extensibility defeats that.

8 hooks cover 95% of use cases (safety guards, observability, response
transformation). Need-driven additions in future ADRs.

## Consequences

- **Enables:** `ctx.on("my_typo", ...)` is a compile error.
- **Constrains:** Plugin authors with novel use cases must request a
  hook addition (well-defined process).
