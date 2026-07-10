---
"@theokit/sdk": minor
---

**SE15 — `iteration` count on the delegation-hook context (reject-after-N).**

`DelegationStartContext` and `DelegationCompleteContext` (from `@theokit/sdk/a2a`) gain `iteration: number` — a 1-based per-`defineSubAgent`-instance invocation counter, incremented before `onDelegationStart` runs (a rejected delegation still counts). This enables the Mastra reject-after-N-iterations pattern: `onDelegationStart: (ctx) => ctx.iteration > 8 ? { proceed: false, rejectionReason } : { proceed: true }`. `onDelegationComplete` sees the same iteration its `onDelegationStart` did.

Also fixes a delegation-hook DX regression: `onDelegationStart` / `onDelegationComplete` now accept a **side-effect-only (void-returning) callback** (e.g. `(ctx) => { log(ctx) }`) — the common case, mirroring Mastra's `async ctx => { … }` hooks — via a shared `DelegationHookResult<T>` return type. Additive + backward-compatible. From the Mastra supervisor-agents comparison (SDK Evolution roadmap SE15).
