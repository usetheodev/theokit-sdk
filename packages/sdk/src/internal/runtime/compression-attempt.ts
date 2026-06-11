/**
 * T2.2 step 4b — Compression attempt orchestrator (ADR D440).
 *
 * Integrates the 4 foundation modules:
 *   - `shouldAttemptCompression` (decision)
 *   - `selectCompressionWindow` (existing helpers)
 *   - `compressConversationWindow` (summarizer)
 *   - `CompressionState` mutation (counter management)
 *
 * Returns a discriminated result: `{ compressed: true, messages }` when
 * compression succeeded, or `{ compressed: false }` when the decision
 * said no or the LLM failed. The caller (loop.ts `runIteration`)
 * uses this to decide whether to retry the LLM turn with compressed
 * messages or propagate the original error.
 *
 * @internal
 */

import type { CompressionState } from "./compression-decision.js";
import { shouldAttemptCompression } from "./compression-decision.js";
import { selectCompressionWindow } from "./compression-helpers.js";
import { type CompressibleMessage, compressConversationWindow } from "./compression-summarizer.js";

export type CompressionAttemptResult =
  | { compressed: true; messages: CompressibleMessage[] }
  | { compressed: false };

/**
 * Attempt context-window compression if the decision matrix allows it.
 *
 * @param opts.errorCode — the error code from the failed LLM call
 * @param opts.messages — the current conversation messages
 * @param opts.state — mutable compression state (counters)
 * @param opts.model — resolved compression model id
 * @param opts.callLlm — injected LLM caller DI seam
 * @param opts.preserveLast — messages to keep verbatim (default 6)
 *
 * @returns `{ compressed: true, messages }` on success;
 *          `{ compressed: false }` when decision says no or LLM fails
 *
 * Side effect: increments `state.attemptsUsed` when an attempt is made
 * (regardless of success/failure — the attempt itself counts toward cap).
 *
 * @internal
 */
export async function attemptCompressionIfNeeded(opts: {
  errorCode: string | undefined;
  messages: readonly CompressibleMessage[];
  state: CompressionState;
  model: string;
  callLlm: (model: string, system: string, user: string) => Promise<string>;
  preserveLast?: number;
}): Promise<CompressionAttemptResult> {
  if (!shouldAttemptCompression(opts.errorCode, opts.state)) {
    return { compressed: false };
  }

  // Attempt counts toward cap regardless of outcome.
  opts.state.attemptsUsed++;

  const { toCompress, toPreserve } = selectCompressionWindow(opts.messages, opts.preserveLast ?? 6);

  if (toCompress.length === 0) {
    // Nothing to compress — all messages are in the preserve window.
    return { compressed: false };
  }

  try {
    const summary = await compressConversationWindow({
      messages: toCompress,
      model: opts.model,
      callLlm: opts.callLlm,
    });
    return {
      compressed: true,
      messages: [summary, ...toPreserve],
    };
  } catch {
    // LLM failure — per ADR D440 failure mode: WARN + return original
    // conversation unchanged. The counter is already incremented above
    // so the cap still advances toward exhaustion.
    return { compressed: false };
  }
}
