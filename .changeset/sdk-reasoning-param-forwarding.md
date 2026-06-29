---
'@theokit/sdk': patch
---

Forward `ModelSelection.params` reasoning to OpenRouter / OpenAI-compat providers (issue #47). The `thinking` param was silently dropped (model resolution kept only `model.id`; the request body had no `reasoning` field), so `Agent.send` never requested or surfaced reasoning. Now a `thinking` param maps to the reasoning request the target provider accepts — OpenRouter (and OpenAI-compatible passthroughs) use the unified `reasoning: { effort }` object, while native OpenAI Chat Completions uses the top-level `reasoning_effort` string (so opting into reasoning never 400s on api.openai.com). The streamed reasoning (`delta.reasoning`, or `delta.reasoning_content` on DeepSeek-direct / vLLM / LMStudio compat endpoints) is surfaced as `thinking-delta` `InteractionUpdate`s (live via `onDelta`) plus a `thinking` `SDKMessage` (replayed by `Run.stream`), on a separate channel from the visible answer. Validated end-to-end against `deepseek/deepseek-r1` via OpenRouter.
