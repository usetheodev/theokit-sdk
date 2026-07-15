---
"@theokit/sdk": minor
"@theokit/sdk-tools": minor
---

SE37 — Reasoning ergonomics. Ships `ReasoningTools.create()` (`think`/`analyze` scratchpad tools, from `@theokit/sdk` core, re-exported by `@theokit/sdk-tools`) and a lightweight `AgentOptions.reasoning?: boolean` flag. When `reasoning: true`, the agent gets a chain-of-thought preamble prepended to its system prompt AND the reasoning tools auto-attached, turning a non-reasoning model into a reason→act→observe loop using the SAME model (reuses the existing tool loop; no new runtime). Inert (with a one-time warn) when a native reasoning model is configured (`model.params: [{ id: "thinking" }]`) — native reasoning wins, no double-reasoning. Default off; byte-identical behaviour when unset. Validated REAL on OpenRouter: `reasoning: true` drove the `think` tool and answered the "9.11 vs 9.9" trap correctly (9.9).
