# ADR 0008 — Guardrail processors are a first-class pipeline, not overloaded hooks (SE24)

- **Status:** Accepted (2026-07-10)
- **Milestone:** SE24 (SDK Evolution — Mastra Guardrails parity)
- **Relates:** SE1 (tool-side veto / PermissionEngine), SE2 (`RunEvent` stream), the existing plugin hook seam (`pre_user_send`, `transform_llm_output`)

## Context

Mastra ships `inputProcessors` / `outputProcessors` — an ordered, per-agent pipeline
that normalizes / validates / blocks / rewrites the user message (input) and the model's
response (output), with `abort()` → `tripwire`, and an `onViolation` callback. TheoKit
had only a **tool-side** guardrail (SE1 `pre_tool_call` veto + `PermissionEngine`). The
**message-side** seam was absent: `pre_user_send` only injects `<memory-context>` (its
`PreUserSendResult` cannot block/rewrite the message), and `post_assistant_reply` is
fire-and-forget (cannot redact). A wired-but-narrow `transform_llm_output` plugin hook
can fold the output text but cannot `abort`, is unordered plugin-aggregated, and carries
no tripwire/onViolation.

Two options for the new seam:

1. **Extend the existing hooks** — give `pre_user_send` a block/rewrite result and
   `post_assistant_reply` a redact result.
2. **A dedicated `Processor` pipeline** — `AgentOptions.inputProcessors` / `outputProcessors`.

## Decision

**Ship a dedicated, first-class `Processor` pipeline** (`inputProcessors` /
`outputProcessors` on `AgentOptions`), NOT an overload of the plugin hooks. Rationale:

- **Ordering + per-agent** — processors run in declared array order on a specific agent;
  plugin hooks are unordered, aggregated across all installed plugins. Guardrail order is
  semantically load-bearing (normalize → detect → redact), so the ordered array is the
  right shape.
- **Abort semantics** — a guardrail must be able to STOP the run. Hooks either transform
  (`transform_llm_output`) or veto a tool (`pre_tool_call`); neither aborts a message with
  a run-level tripwire. Bolting abort onto `pre_user_send` would overload a memory-recall
  hook with an unrelated concern (SRP).
- **Clarity** — "a guardrail is not a plugin." Mastra separates them; so do we. A consumer
  reasons about `inputProcessors: [...]` without learning the plugin lifecycle.

The pipeline **reuses existing mechanism** where it can (DRY): input processors run in the
send pipeline (`executeSendLocked`) at the same point the message is prepared, before any
side effect; output processors wrap the run's `wait()` (the same Proxy idiom as
`wrapRunWithPostReplyHook`) and run INNER of the post-reply hook so memory observes the
final redacted text.

**Core ships NO `strategy` enum.** `block` = `ctx.abort(reason)`; `rewrite`/`redact` =
return the transformed string; `warn`/`detect` = `ctx.warn(message, detail)` (fires
`onViolation`, continues). Strategy is a processor-level convention over these three
primitives — the built-in processors (SE25) expose a `strategy` option that maps onto them.

## Tripwire shape

- **`abort()`** throws an internal sentinel caught by the runner, which fires the
  processor's `onViolation` and returns a tripwire.
- **On `wait()`**: `RunResult { status: "cancelled", tripwire: { reason, processorId } }`.
  `status` reuses `"cancelled"` (no new status token — a tripwire is a guardrail-driven
  cancel); the `tripwire` field distinguishes it from a user/`cancel()` cancel.
- **On the stream path**: a `RunTripwireEvent { type: "tripwire", reason, processorId }` is
  emitted via `SendOptions.onRunEvent` (the SE2 event sink) — mirrors the `wait()` field.
- **Input abort** never reaches the model — it returns a terminal `TripwireRun` (a Run
  born `cancelled`, `stream()` empty). **Output abort** turns a finished run's result into
  the tripwire on `wait()`.

## Cloud serialization

A `Processor` carries function handlers (`processInput`/`processOutput`/`onViolation`) that
cannot survive JSON serialization to TheoCloud. `validateCloudToolParity` **rejects** a
cloud agent that declares any processor (`cloud_incompatible_function_resolver`), mirroring
the `systemPrompt` / `skills` function-resolver cloud rule. Guardrails run on local agents,
or move into a server-side gateway in front of TheoCloud.

## Consequences

- Message-side guardrails are now possible for the FIRST time — SE25 (deterministic
  processors) and SE26 (delegated classifiers) both build on this seam.
- Back-compat: no processors ⇒ identical behavior; the send pipeline's new branch is
  guarded by `inputProcessors?.length`.
- **Streaming output redaction is DEFERRED** (v1 processes the buffered `wait()` path
  only). Redacting tokens mid-`stream()` is a heavier, separate concern (Mastra models it
  as a distinct `processOutputStream`); a follow-up milestone with demand evidence.
- The narrow `transform_llm_output` plugin hook stays as-is (a plugin-level fold); it is
  NOT deprecated — a plugin may still use it. Processors are the per-agent, abort-capable
  surface.

## Alternatives considered

- **Extend `pre_user_send` / `post_assistant_reply`.** Rejected: overloads memory-recall
  hooks with guardrail semantics (SRP), loses ordering, and forces a block-capable result
  onto a hook whose consumers expect fire-and-forget. Reopen only if the two systems prove
  redundant in practice.
- **A `strategy` enum in core.** Rejected: `block`/`rewrite`/`redact`/`warn` reduce to
  abort/return/warn primitives; a core enum would duplicate that and couple core to Mastra's
  exact vocabulary. Strategies live in the built-in processors (SE25).
- **A new `"tripwire"` RunStatus.** Rejected: a tripwire IS a cancel (the run stopped before
  completing); reusing `"cancelled"` + the `tripwire` field avoids a breaking status-union
  change for every consumer switching on `status`.
