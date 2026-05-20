# D145 — Agent loop integrates memory via 2 hook names, not a parallel manager

**Date:** 2026-05-20
**Status:** Accepted

## Decision

Memory adapters interpose in the agent loop through two new entries
in the existing `HookName` union:

- `pre_user_send` — fires before `dispatchRun`. Concatenates
  `recalledContext` from all handlers and wraps as
  `<memory-context>\n...\n</memory-context>\n\n${prompt}`.
- `post_assistant_reply` — fires after `run.wait()` resolves.
  Fire-and-forget — errors → stderr (EC-O); never blocks the caller.

`PluginManager.runPreUserSendHooks(ctx, maxRecallContextBytes)` caps
the total recalled context at `AgentOptions.maxRecallContextBytes`
(default 16_000) per EC-A. `runPostAssistantReplyHooks` iterates
fire-and-forget with per-handler error isolation.

## Rationale

The hook infrastructure (D100 `HookName` enum + `PluginContext.on()` +
`PluginManager` dispatch) already exists. Adding 2 enum values costs
~30 LoC dispatch + ~50 LoC integration vs ~200 LoC for a parallel
`MemoryManager` subsystem.

Hermes uses a dedicated `MemoryManager` because Python lacks the
fluent hook system the SDK already has. We don't need a second one.

## Consequences

- **Enables:** memory adapters share the dispatcher non-memory plugins
  use; consumers can write hook handlers that observe the SDKMessage
  stream the same way; testing via `PluginManager.runPreUserSendHooks`
  is straightforward.
- **Constrains:** memory adapters can't have private state beyond what
  the closure captures — they must be self-contained. The current
  three adapters are.
