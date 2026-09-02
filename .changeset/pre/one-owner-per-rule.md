---
"@theokit/sdk": patch
---

Three pieces of duplicated logic now have one owner each. One internal error message improves.

The `~4 chars per token` estimate had two `@public` implementations reachable from two entry points —
`built-in-processors.ts` with a named constant, `compaction.ts` with the ratio inlined. Tuning it, or
switching to code points instead of UTF-16 units (a caveat both docblocks already carried), would have
silently diverged them. It lives in `compaction.ts` now, with `CHARS_PER_TOKEN` exported beside it;
`built-in-processors.ts` re-exports both under the same names, so nothing published changes.

The error-body reader duplicated character-for-character in the Bedrock and Vertex mappers is one
`parseErrorBody` in their shared module. It describes how `fetch` surfaces a body, which is the same
whoever sent it.

`abortError` had three copies — including inside the two files the extraction's own docblock named as
the ones that should stop having one. **One of the three behaved differently**: the pool-aware client
discarded a non-`Error` abort reason and raised a generic `"AbortError"`. All three are now the shared
implementation, which carries the caller's reason through. If you cancel with
`controller.abort("shutting down")` and the pool-aware client is in the path, the rejection message is
now `shutting down` rather than `AbortError`.
