---
"@theokit/sdk": minor
---

**SE10 — subagent delegation forwards the parent's `AbortSignal` (cancellation propagation).**

`defineSubAgent()` (from `@theokit/sdk/a2a`) now threads the run's cancellation into the child agent. When the agent loop dispatches the subagent tool it already passes the run's `AbortSignal` as the handler's `ctx.signal`; the subagent handler now forwards that signal to the child `agent.send(input, { signal })`. Aborting the parent run cancels the in-flight subagent at its next step instead of letting it run to completion (and burn tokens).

- Additive + backward-compatible: a handler invoked with no `ctx` (single-arg call sites) behaves exactly as before — no signal, no cancellation.
- The child agent is still disposed in `finally`, including on cancel.

Matches the Mastra supervisor-agents "abortSignal forwarded to delegated subagents" behavior (SDK Evolution roadmap SE10).
