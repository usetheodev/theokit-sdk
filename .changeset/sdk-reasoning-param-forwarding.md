---
'@theokit/sdk': patch
---

Forward `ModelSelection.params` reasoning to OpenRouter / OpenAI-compat providers (issue #47). The `thinking` param was silently dropped (model resolution kept only `model.id`; the request body had no `reasoning` field), so `Agent.send` never requested or surfaced reasoning. Now a `thinking` param maps to OpenRouter's unified `reasoning: { effort }` request field, and the streamed `delta.reasoning` is surfaced as `thinking-delta` `InteractionUpdate`s (live via `onDelta`) plus a `thinking` `SDKMessage` (replayed by `Run.stream`), on a separate channel from the visible answer. Validated end-to-end against `deepseek/deepseek-r1` via OpenRouter.
