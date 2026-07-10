---
"@theokit/sdk": minor
---

**SE12 — opt-in parent-context forwarding for subagents (`messageFilter`).**

`SubAgentSpec` (from `@theokit/sdk/a2a`) gains an optional `messageFilter`. When set, `defineSubAgent` forwards a filtered view of the supervisor's conversation to the child; when absent, the child runs input-only — **memory isolation stays the default**.

- New `ctx.messages` on the custom-tool handler `ToolContext`: a **read-only, text-only** projection of the current turn's transcript (`ToolContextMessage[]`), threaded by the agent loop the same way `ctx.signal` (#65) and `ctx.context` (M7) are. Non-text parts (tool calls / results) are dropped — a tool never sees raw wire parts or nested tool args.
- `messageFilter({ messages, input, name })` returns the subset to forward; `defineSubAgent` prepends it to the delegated input as a role-tagged context preamble. A filter returning `[]` forwards nothing. A filter that drops sensitive turns (e.g. anything `confidential`) provably keeps them out of the child context.

New exported types: `ToolContextMessage`, `MessageFilterArgs`. Additive + backward-compatible. Rationale + the transcript-exposure trade-off are recorded in ADR 0005. From the Mastra supervisor-agents comparison (SDK Evolution roadmap SE12).
