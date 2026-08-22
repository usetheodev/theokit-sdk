---
"@theokit/sdk": minor
"@theokit/sdk-cache": patch
---

`PostAssistantReplyContext` now carries `usedTools`, and `@theokit/sdk-cache` stops caching
tool-using turns in plugin mode.

The cache's D266/EC-10 guard exists because replaying an answer produced by a `write_file` / HTTP
POST / payment call re-serves the text without the side effect having happened. The
`post_assistant_reply` hook had no tool signal to key on and passed a literal `false`, so the guard
never fired on the path that runs automatically — only a hand-written `cache.remember(..., {
usedTools: true })` reached it.

The runtime derives the flag from the run's replayed event stream. A hook handler written against
the previous shape keeps working; code that CONSTRUCTS a `PostAssistantReplyContext` (test doubles,
custom emitters) now has to supply the field.
