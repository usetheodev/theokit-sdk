---
"@theokit/sdk": minor
---

**SE13 — `modifiedMaxSteps` on `onDelegationStart` (cap the subagent's iterations).**

`DelegationStartDecision` (from `@theokit/sdk/a2a`) gains `modifiedMaxSteps?: number`. When an `onDelegationStart` hook returns it (and does not reject), `defineSubAgent` forwards it as `SendOptions.maxIterations` to the child `agent.send`, capping how many tool-loop rounds the subagent may run. Composes with SE10 (`signal`) and SE12 (`messageFilter` preamble) onto a single child `send`. Absent ⇒ the child uses its default iteration ceiling (unchanged).

Completes the SE11 `onDelegationStart` decision contract (the deferred `modifiedMaxSteps` — the `SendOptions.maxIterations` plumbing already existed). Additive + backward-compatible. From the a peer framework supervisor-agents comparison (SDK Evolution roadmap SE13).
