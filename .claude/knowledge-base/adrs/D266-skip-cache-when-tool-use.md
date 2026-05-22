# D266 — Don't cache runs that invoked tools (EC-10 absorbed)

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`performStore` skips storage when the original run invoked any tool (`ctx.result?.usedTools === true`). Only "pure" runs (LLM generated text without tool side-effects) get cached.

## Rationale

Cache replay returns only the final text. If the original run called `fs.delete(X)`, caching its response "deleted" would replay "deleted" on the next paraphrase WITHOUT executing the tool — silent state corruption in any transactional scenario.

## Consequences

- Tool-heavy workloads (coding agents, file ops, API calls) gain no cache benefit.
- Pure-text workloads (FAQ, classify, summarize) capture full savings.
- Documented trade-off in `docs.md`.
- v1.x may add opt-in `cacheToolResults: true` if demand surfaces and tool-call equivalence has a signature.
