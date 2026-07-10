---
"@theokit/sdk": minor
---

**SE15 — `iteration` count on the delegation-hook context (reject-after-N).**

`DelegationStartContext` and `DelegationCompleteContext` (from `@theokit/sdk/a2a`) gain `iteration: number` — a 1-based per-`defineSubAgent`-instance invocation counter, incremented before `onDelegationStart` runs (a rejected delegation still counts). This enables the a peer framework reject-after-N-iterations pattern: `onDelegationStart: (ctx) => ctx.iteration > 8 ? { proceed: false, rejectionReason } : { proceed: true }`. `onDelegationComplete` sees the same iteration its `onDelegationStart` did.

Also fixes a delegation-hook DX regression: `onDelegationStart` / `onDelegationComplete` now accept a **side-effect-only (void-returning) callback** (e.g. `(ctx) => { log(ctx) }`) — the common case, mirroring a peer framework's `async ctx => { … }` hooks — via a shared `DelegationHookResult<T>` return type. Additive + backward-compatible. From the a peer framework supervisor-agents comparison (SDK Evolution roadmap SE15).
