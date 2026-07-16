# `examples/abort-mid-stream` — Production-Readiness #5

Demonstrates `AbortSignal` end-to-end propagation: caller's signal stops upstream token billing mid-stream.

## Run

```bash
# Fixture mode (validates wiring):
pnpm run

# Real LLM (actual token-billing stop visible in OpenRouter dashboard):
OPENROUTER_API_KEY=sk-or-... pnpm run
```

## What it shows

1. **Pre-aborted signal:** `controller.abort()` before send; signal flows to `fetch({ signal })` at LLM client level.
2. **Mid-stream abort (real LLM only):** start a long generation, abort after 200ms; `AgentRunError({ code: "aborted", retriable: false })` thrown, partial assistant message NOT persisted (D320).
3. **`agent.dispose()` lifecycle abort:** the agent owns a `#lifecycleAbortController` that fires on dispose, canceling in-flight sends. Dispose is idempotent (D5).

## Edge runtimes

The SDK ships `anySignal` ponyfill (D324) so `AbortSignal.any` semantics work on some Edge runtime subsets that lack the native method. See the exported cancellation types for the full contract.
