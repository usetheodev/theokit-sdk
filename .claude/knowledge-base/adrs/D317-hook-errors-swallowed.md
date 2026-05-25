# D317 — Tool lifecycle hook errors are swallowed with stderr warn

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 5, T5.3

## Decision

When a `onToolStart` / `onToolEnd` / `onToolError` callback throws or rejects, the error is logged to stderr (`[theokit-sdk] tool lifecycle hook threw: <msg>`) and the run continues normally. The error does NOT propagate to `agent.send()`'s rejection.

This is implemented as a single `safeEmitToolHook` helper that wraps the callback call in `try/catch`.

## Rationale

**Observation must not crash the host.** A listener that throws (DB connection failed, metrics sink unavailable, listener bug) MUST NOT crash the agent run. Match the pattern of:
- Plugin manager (D101): `pre_tool_call` decision errors swallowed
- `LiveAgentRegistry.onEvict` (D309): listener errors swallowed
- `safeCall` in system-prompt path: callback errors logged + skipped

Contrast with **quota hooks** (D322): those are admission gates, not observers — errors propagate by design.

EC-6 absorbed: even when `onToolError` event payload's `error` field is constructed from a stderr string (validate failure has no Error instance), the helper still wraps in `new Error(reason)` so consumers always see an Error instance.

## Alternatives considered

- **Propagate hook errors** — rejected. Listener bugs would crash production runs.
- **Capture errors into a separate "hook errors" event** — rejected. Adds noise to the run output; stderr warn is searchable.

## Consequences

- Bugs in listeners mask silently. Mitigation: stderr is searchable + tests pin the listener contract.
- The 3 hooks are best-effort observation, not enforcement.
