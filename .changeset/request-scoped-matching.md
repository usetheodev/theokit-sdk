---
"@theokit/sdk": patch
---

Make the leaked-dialect recovery **request-scoped (R5)**. The opt-in `extractToolCallsFromContent` recovery previously promoted ANY `<function=NAME>` block leaked into assistant text on an enabled route, so a code assistant printing a literal `<function=example>` in a fenced code block could be wrongly turned into a tool call. Recovery now gates on an exact, case-sensitive allowlist derived automatically from the current request's declared tools (`request.tools`): the per-route flag stays the coarse enable, and the allowlist is the precise false-positive guard. A request with no tools recovers nothing; a gated-out block keeps its text visible (it is not silently deleted). No public API change — the allowlist is derived from the tools you already pass. Mirrors peer-project's `@peer-project/tool-call-repair` allowlist.
