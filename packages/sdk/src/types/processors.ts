/**
 * Owner: `internal/runtime/processors/` (3 of 4 importers). Derived from the import graph, not declared —
 * `tests/lint/types-name-their-owner.test.ts` re-derives it.
 *
 * SE24 — guardrail processor pipeline. A `Processor` inspects/transforms/blocks
 * the user message (input) or the model's final text (output). Processors run in
 * order; each may rewrite its payload, `abort(reason)` to stop the run (surfaced
 * as {@link RunResult.tripwire} + a `tripwire` run-event), or `warn()` to report
 * a non-blocking violation. The pipeline is provider-agnostic and carries NO LLM
 * — an LLM-classifier processor is the consumer's (delegated, see the guardrails
 * ADR). Mirrors a peer framework's `inputProcessors` / `outputProcessors`.
 *
 * @public
 */

/**
 * A policy violation surfaced to a processor's {@link Processor.onViolation}
 * callback — on `abort()` (blocking) AND on `warn()` (non-blocking).
 *
 * @public
 */
export interface ProcessorViolation {
  processorId: string;
  message: string;
  detail?: unknown;
}

/**
 * Controls available to a processor while it runs: `abort()` stops the run with
 * a tripwire; `warn()` reports a non-blocking violation and continues.
 *
 * @public
 */
export interface ProcessorControls {
  /** Stop the run immediately with a tripwire. Throws — code after it never runs. */
  abort(reason: string): never;
  /** Report a non-blocking violation (fires `onViolation`); the run continues. */
  warn(message: string, detail?: unknown): void;
}

/** Context passed to {@link Processor.processInput}. @public */
export interface InputProcessorContext extends ProcessorControls {
  /** The user message text for this send. */
  message: string;
  agentId: string;
}

/** Context passed to {@link Processor.processOutput}. @public */
export interface OutputProcessorContext extends ProcessorControls {
  /** The model's final assistant text for this run. */
  text: string;
  agentId: string;
}

/**
 * A guardrail processor. Provide `processInput` (runs before the LLM) and/or
 * `processOutput` (runs on the final text). A processor's `strategy` (block /
 * rewrite / redact / warn) is expressed via the {@link ProcessorControls}:
 * return the transformed payload to rewrite/redact, `abort()` to block, `warn()`
 * to report without blocking. The core ships no strategy enum — strategies are a
 * processor-level convention over these primitives.
 *
 * @public
 */
export interface Processor {
  /** Stable id — surfaced on {@link ProcessorViolation} and {@link RunResult.tripwire}. */
  id: string;
  /**
   * Transform or block the user message before it reaches the model. Return the
   * (possibly rewritten) text; returning nothing (void) preserves the message
   * unchanged. May be `async`.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` is intentional — an observe-only processor returns nothing (preserves the payload), the same shape a peer framework allows.
  processInput?(ctx: InputProcessorContext): string | Promise<string> | void;
  /**
   * Transform or block the model's final text before it reaches the caller.
   * Return the (possibly redacted) text; returning nothing (void) preserves the
   * text unchanged. May be `async`.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` is intentional — an observe-only processor returns nothing (preserves the payload), the same shape a peer framework allows.
  processOutput?(ctx: OutputProcessorContext): string | Promise<string> | void;
  /** Fires on `abort()` and `warn()`. Errors thrown here are swallowed (never break the pipeline). */
  onViolation?(violation: ProcessorViolation): void;
}

/**
 * The tripwire detail attached to {@link RunResult.tripwire} when a processor
 * aborts, and carried by the `tripwire` run-event.
 *
 * @public
 */
export interface ProcessorTripwire {
  reason: string;
  processorId: string;
}
