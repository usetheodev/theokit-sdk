# D101 — `pre_tool_call` veto returns `{ block: true, message }`, never throws

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D89, D100

## Decision

Plugin `pre_tool_call` handlers can return `{ block: true, message }` to
veto a tool call. The loop converts this into a tool_result with
`isError: false, content: message` so the LLM receives the block as
context (not a crash) and can self-correct.

Throwing in a handler propagates normally — reserved for emergencies.

## Rationale

Hermes pattern (`tool-call-failure-recovery.md:215-222`): tool errors
return as `tool_result`, not as throws. Plugin veto inherits the same
posture — the LLM stays in the loop and chooses the next move (try
different args, try another tool, or end with an explanation).

## Consequences

- **Enables:** safety guards (`rm -rf` blocker, MCP OAuth approval,
  skill content scanner) without crashing the loop.
- **Constrains:** caller of `runPreToolCallHooks` MUST check the return
  value (first block wins, undefined means no veto).
