# D249 — `Cache` is static class with `Cache.semantic` factory + `.asPlugin()` returning Plugin

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`Cache` exposed as class with private constructor. `Cache.semantic(options)` validates options via Zod and returns instance. `cache.asPlugin()` returns a `Plugin` (kind: "cache") registrable via `Agent.create({ plugins: [cache.asPlugin()] })`.

## Rationale

Pattern established in 6 prior façades (Agent.create, Eval.create, Handoff.create, Workflow.create, Cron.create, Memory.create). Plugin shape (D98) is the canonical mechanism for non-invasive extension. Caller controls composition explicitly.

## Consequences

- Type-tests trivial; caller composes with other plugins seamlessly.
- Cache deactivated by removing from `plugins[]` — no global `set_llm_cache(null)` anti-pattern.
- Forward-compat: other cache flavors (KV-only, prompt-prefix) become `Cache.exact(...)`, `Cache.prefix(...)` future siblings.
