# D89 — Tool errors return as `tool_result isError: true`, never throw

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D86, plan `agent-core-loop-completion-plan.md`

## Decision

Every failure path in `dispatchToolWithRepair` returns a `DispatchResult`
with `isError: true`:

- Unknown tool name → "Unknown tool: X. Available: ..."
- Schema validation fail → "Invalid arguments for X: <reason>"
- Handler throws → "Tool execution failed: <message>"

The function NEVER throws — the throw is caught and converted to an
`isError` result. The agent loop converts this into a `tool_result` LLM
message so the model receives the error and can self-correct.

## Rationale

Throwing breaks the conversation loop. The LLM can't react to an error it
never saw; the user only sees the agent crash. Returning the error as a
tool result preserves the loop's linear control flow:

1. LLM emits tool call.
2. Dispatch returns isError.
3. Loop converts to tool_result for the LLM.
4. LLM reads the error, decides next action (retry with different args,
   try another tool, or end with a final answer).

Existing `agent-loop/tool-dispatch.ts:122-128` already did this for
Unknown tool. D89 generalizes the rule to all failure paths.

## Consequences

- **Enables:** model self-correction without operator intervention. Loop
  stays linear, telemetry stays clean.
- **Constrains:** caller of `dispatchToolWithRepair` MUST check
  `result.isError` before assuming success.
