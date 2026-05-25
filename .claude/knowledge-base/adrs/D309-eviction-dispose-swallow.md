# D309 — Eviction triggers `dispose()` with errors swallowed

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 2, T2.4

## Decision

Every eviction (LRU / idle / explicit) calls `agent.dispose()`. If `dispose()` throws or rejects, the error is logged to stderr but does NOT abort the eviction or propagate to the caller.

```ts
try {
  await agent.dispose();
} catch (cause) {
  process.stderr.write(`[theokit-sdk] dispose during eviction failed (${id}): ${cause.message}\n`);
}
```

## Rationale

**Eviction must not block on a misbehaving agent.** A `dispose()` that hangs (stuck MCP server, never-resolving stream cancellation) or throws (cleanup race) MUST NOT prevent the cache from making room for new entries. Otherwise the OOM Phase 2 is solving comes back as "cache full, can't add new agents".

stderr log is searchable + telemetry-visible. Combined with the optional `onEvict` listener, operators can observe disposal failures and investigate without the runtime stalling.

## Alternatives considered

- **Propagate dispose errors to caller** — rejected. Caller invoked `set()` (which triggers eviction async). They have no semantic relationship to the unrelated old agent's lifecycle.
- **Skip dispose on eviction** — rejected. Resource leaks (MCP child processes, file handles) accumulate.
- **Retry dispose with backoff** — rejected. Over-engineering. If dispose is broken, retry won't fix it — telemetry/alerts will.

## Consequences

- Bugs in `dispose()` mask silently. Mitigation: stderr is searchable + onEvict observes every eviction.
- Memory leaks via incomplete dispose are possible but quantifiable (telemetry).
