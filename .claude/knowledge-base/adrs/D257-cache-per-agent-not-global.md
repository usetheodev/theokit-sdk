# D257 — Cache is per-Agent, NOT global state. Opt-in via `plugins: [cache.asPlugin()]`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Cache is NEVER registered globally. Caller mounts `cache.asPlugin()` and passes to `Agent.create({ plugins: [cache] })`. Multiple agents can share one `Cache` instance.

## Rationale

LangChain Python `set_llm_cache()` is multi-tenant anti-pattern. Per-agent gives explicit control + testability + natural isolation.

## Consequences

- Tests instantiate cache + agent separately.
- Cache instance is shared via reference assignment (mesmo `Cache` em N Agents) — explicit pattern.
