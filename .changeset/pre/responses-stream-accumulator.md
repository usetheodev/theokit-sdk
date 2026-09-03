---
"@theokit/sdk": patch
---

The Responses-API transport's SSE state machine is a class, and the eight event kinds it handles are
now covered by tests.

`ResponsesApiClient.stream` inlined the whole dispatch: one 165-line generator, ten mutable locals
and eight `else if` arms, carrying a suppression that described it as "mirroring
`OpenAIStreamAccumulator.consume`". It mirrored what that method does, not how it is organised —
`consume` is seven lines delegating to small private methods. The state machine now lives in a
`ResponsesStreamAccumulator` shaped like its sibling, the suppression is gone, and every function in
the file is under the complexity threshold the project sets for itself.

The refactor is behaviour-preserving, and that claim was measured rather than asserted. Each arm of
the dispatch was mutated in turn before the change: three of eight killed a test, five did not — the
reasoning deltas, the incremental tool-argument accumulation, `response.incomplete` → `max_tokens`,
the reasoning/cache token counters, and the in-stream failure path. Notably, a comment in the
existing suite claimed the argument deltas were exercised "because the parsed input below can only
be right if they were accumulated"; deleting the accumulation left that suite green, because the
recorded fixture repeats the full arguments on the terminal event.

Eight characterisation tests close those gaps, and re-running the battery after the extraction kills
all eleven mutants. Two behaviours documented for the first time by that battery: the tool name is
taken from the frame that announced the call when the completion frame omits it, and frames sent
after `[DONE]` are ignored.

No public API changed.
