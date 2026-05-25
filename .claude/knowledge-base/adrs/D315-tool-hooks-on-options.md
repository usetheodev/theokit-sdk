# D315 — Tool lifecycle hooks live on `AgentOptions`, not plugin context

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 5, T5.1

## Decision

Tool lifecycle observation callbacks (`onToolStart`, `onToolEnd`, `onToolError`) are top-level fields on `AgentOptions`, NOT registered through the `PluginContext.on(hook, handler)` plugin surface.

## Rationale

**Plugin overhead is overkill for an observation spy.** The plugin system (D97-D101) requires defining a `definePlugin({ kind: "general", register })` object just to attach a hook. For one-line cost-tracking integration like:

```ts
onToolEnd: (e) => metrics.recordToolLatency(e.toolName, e.durationMs),
```

…asking the consumer to write a plugin is friction. Match Vercel AI SDK's `onChunk` / `onFinish` callbacks + OpenAI SDK's stream events.

Internally, the runtime still feeds these into a `safeEmitToolHook` helper that mirrors `pre_tool_call` veto pattern's error handling (D101) — listener throws logged + swallowed.

## Alternatives considered

- **Plugin-only via `pluginManager.fireHook("post_tool_call")`** — rejected. Forces 10x more code per consumer for what is a one-line spy.
- **Both surfaces (AgentOptions AND plugin)** — rejected. Two ways to do the same thing creates confusion.

## Consequences

- Consumers wire metrics with 3 lines instead of a plugin definition.
- The plugin system still owns `pre_tool_call` veto (semantically distinct — blocks vs observes).
- Tests focus on the AgentOptions surface; plugin manager tests cover the orthogonal veto flow.
