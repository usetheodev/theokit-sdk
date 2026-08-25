---
'@theokit/sdk': patch
---

The Responses transport now reads `input_tokens_details.cached_tokens` and `.cache_write_tokens`,
so a consumer can tell what a turn actually cost.

`input_tokens` INCLUDES the slice the provider served from its prompt cache. This transport reported
`cacheReadTokens: 0` regardless, so adding input to output counted tokens nobody is paying for.
Measured on a three-round turn with `prompt_cache_key` in use: the provider reported
`cached_tokens: 4608` on every round, and the consumer received 9,835 where 619 were new — 16x.

The sibling Chat Completions transport has always read the equivalent
(`prompt_tokens_details.cached_tokens`); this one read `output_tokens_details.reasoning_tokens`
beside it and skipped this one. The response type declared neither, so it was invisible at the type
level too.

It matters beyond an inaccurate number: it makes the SDK look expensive when it is not. Comparing a
consumer against OpenAI Codex on identical tasks, the gross figure said 2.8x. Codex reports the net
figure (`non_cached_input + output`). Measured with the same formula on both sides, the same task
costs 14,317 against 13,560 — inside the run-to-run variance.

Fixes `usetheokit/theokit-sdk#386`.
