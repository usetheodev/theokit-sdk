# D318 — `SendOptions.signal` propagates to LLM `fetch({ signal })`

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 4, T4.1

## Decision

`SendOptions.signal` (already typed in `types/run.ts:149`) is now wired end-to-end:

1. `LocalAgent.send` composes user's signal with `lifecycleAbortController.signal` via `anySignal` (D319).
2. The composed signal lands in `SendOptions.signal` on the composed-options object passed to `dispatchRun`.
3. `real-local-run.buildLoopInputs` forwards `options.sendOptions.signal` to `AgentLoopInputs.signal`.
4. `streamLlmTurn` in `agent-loop/loop.ts` uses `inputs.signal ?? new AbortController().signal` — caller's signal when present, never-aborting placeholder otherwise.
5. LLM clients (`anthropic.ts`, `openai.ts`, etc.) pass `signal` to `fetch({ signal })`. Already accepted historically; wiring was the gap.

## Rationale

The infrastructure was 90% complete — every LLM client already accepted `signal: AbortSignal` (since the SSE parser needed it). The bug was in the orchestrator: `streamLlmTurn` created a fresh, never-aborting controller. User cancels at the browser/route layer never propagated to the upstream provider, so tokens kept billing.

Pure plumbing fix. Zero new abstractions.

## Alternatives considered

- **Add a new top-level `agent.cancel()` API** — rejected. The signal-based contract is the canonical web pattern (`fetch`, ReadableStream, etc.). Inventing parallel imperative API would fork the surface.

## Consequences

- Tokens stop billing the moment the browser disconnects (TheoKit route handler threads `request.signal` to `agent.send`).
- Tools mid-execution still complete (D318 scope is the LLM fetch). Tool authors who want cancel-awareness accept signal in their own opts.
