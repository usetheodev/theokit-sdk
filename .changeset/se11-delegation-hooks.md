---
"@theokit/sdk": minor
---

**SE11 — delegation lifecycle hooks on `defineSubAgent` (`onDelegationStart` / `onDelegationComplete`).**

`SubAgentSpec` (from `@theokit/sdk/a2a`) gains two optional hooks that let the caller intercept a delegation as it happens:

- `onDelegationStart({ input, name })` — return `{ proceed: false, rejectionReason }` to reject the delegation (the child never runs; `rejectionReason` becomes the tool result), or `{ modifiedInput }` to rewrite the prompt sent to the child.
- `onDelegationComplete({ input, name, result?, error? })` — runs after the delegation settles; on success an optional `{ feedback }` is appended to the child's result, and on failure `ctx.error` is set (the error is still re-thrown — never swallowed, Unbreakable Rule 8).

Additive + backward-compatible: specs without hooks behave exactly as before. New exported types: `DelegationStartContext`, `DelegationStartDecision`, `DelegationCompleteContext`, `DelegationCompleteDecision`.

Matches the Mastra supervisor `onDelegationStart` / `onDelegationComplete` control points (SDK Evolution roadmap SE11).
