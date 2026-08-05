---
"@theokit/sdk": patch
---

Removed the dead `tool_use` and `stop` variants from the internal `LlmEvent` union (theokit#144).

They declared a live, provider-level tool channel that never existed: only two providers yielded
them, the agent loop's collector never read them, and the tool calls they carried duplicated
`LlmFinish.toolCalls`. A declaration without a consumer is worse than an omission — it cost
`@theokit/agents` a workaround that held every text delta until the stream drained, which broke
live token streaming on text-only turns (issue #47).

The canonical live tool channel is `onDelta`: the `tool-call-started` / `tool-call-completed`
`InteractionUpdate`s emitted between LLM rounds, uniform across providers and correlated by
`callId`. `Run.events()` merges them with the structural messages into one ordered timeline. This
is now documented on the `LlmEvent` type itself.

Internal type only — no public API change.
