---
"@theokit/sdk": minor
---

**SE24 — guardrail processor pipeline (`inputProcessors` / `outputProcessors`).**

`AgentOptions.inputProcessors` run in order before the LLM (normalize / validate / block / rewrite the user message); `outputProcessors` run on the model's final text before it reaches the caller (redact / block). A `Processor` is `{ id; processInput?; processOutput?; onViolation? }`; each handler receives `ctx` with `abort(reason)` (block → the run stops with `RunResult.tripwire { reason, processorId }` + a `tripwire` run-event via `SendOptions.onRunEvent`) and `warn(message, detail?)` (non-blocking → fires `onViolation`, continues), and returns the (possibly rewritten) payload.

The core ships no `strategy` enum — block/rewrite/redact/warn reduce to `abort` / return-string / `warn` (the built-in SE25 processors expose a `strategy` option over these). An input block never reaches the model (a terminal tripwire run); an output block turns a finished run's result into a tripwire on `wait()`. Streaming output redaction is deferred (v1 processes the buffered `wait()` path). Cloud agents reject processors (function handlers don't serialize). Back-compat: no processors ⇒ unchanged. New public types `Processor` / `ProcessorViolation` / `InputProcessorContext` / `OutputProcessorContext` / `ProcessorControls` / `ProcessorTripwire` / `RunTripwireEvent` + `RunResult.tripwire`. ADR 0008. Mirrors a peer framework Guardrails input/output processors. From the a peer framework Guardrails comparison (SDK Evolution roadmap SE24).
