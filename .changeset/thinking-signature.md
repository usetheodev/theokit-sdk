---
"@theokit/sdk": minor
---

Extended-thinking sessions can be resumed (theokit#122).

Anthropic signs each `thinking` block and verifies that signature when the block is replayed on the
next turn. The SDK captured none of it, so a session that used extended thinking could be persisted
and then never resumed — the next request failed with `400 "thinking blocks cannot be modified"`.

The signature was dropped at four independent points, and fixing any one alone would have changed
nothing:

- the Anthropic adapter never requested extended thinking, so no signature was ever issued;
- it did not parse `thinking` blocks, so neither the text nor the signature left the stream;
- the agent loop emitted a thinking event and dropped it — nothing ever produced a `thinkingMessage`
  step, so no thinking reached the transcript at all;
- the transcript reader discarded `thinking` blocks, so a resumed conversation lost them.

All four are closed, and the block now round-trips from the provider through persistence and back
onto the wire unchanged. Thinking and its answer text stay in one assistant message, in that order,
as Anthropic requires.

A thinking block with no signature — history recorded before this shipped, or reasoning text from an
OpenAI-compatible provider, which is never signed — is kept in the transcript but not replayed to
Anthropic. Sending it unsigned would fail the same validation and break the whole turn rather than
lose one block of context.

`SDKThinkingMessage` and the conversation `ThinkingMessage` gain an optional `signature`.
