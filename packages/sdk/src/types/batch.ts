/**
 * Owner: `src/` (2 of 5 importers). Derived from the import graph, not declared —
 * `tests/lint/types-name-their-owner.test.ts` re-derives it.
 *
 * Public types for `Agent.batch` (ADRs D134-D140).
 *
 * Run N prompts in parallel with bounded concurrency. Each prompt gets
 * a fresh agent (create → send → wait → dispose). Failures isolated
 * per-prompt; the batch never aborts on a single failure.
 *
 * @public
 */

import type { TheokitAgentError } from "../errors.js";
import type { AgentOptions } from "./agent.js";
import type { RunResult } from "./run.js";

/**
 * Single prompt in a batch. Plain string is shorthand for `{ prompt }`.
 *
 * @public
 */
export interface BatchItem {
  /** Prompt text sent to the agent. */
  prompt: string;
  /** Per-prompt system prompt override (wins over `BatchOptions.systemPrompt`). */
  systemPrompt?: string;
  /**
   * Caller-supplied metadata, round-tripped to `BatchResult.metadata`.
   * Passed by reference — do NOT mutate while the batch is in-flight (EC-I).
   */
  metadata?: Record<string, unknown>;
}

/**
 * Options accepted by `Agent.batch`. Extends `AgentOptions` — every
 * prompt gets an agent created with these options (ADR D138 isolation),
 * plus the batch-specific knobs below.
 *
 * @public
 */
export interface BatchOptions extends AgentOptions {
  /**
   * Maximum parallel agents. Default 4 (ADR D136). Must be a positive
   * integer. Capped to `prompts.length` to avoid spinning idle workers.
   *
   * Bounds the WHOLE per-item lifecycle, including `onResult`: a prompt's
   * concurrency slot is not released until its `onResult` callback (if any)
   * has finished (B-110). A caller doing anything stateful in `onResult` —
   * writing a file, appending to a shared buffer, rate-limiting an API — can
   * rely on at most `concurrency` such callbacks running at once.
   */
  concurrency?: number;
  /** Optional filter applied post-collection. Return `false` to discard. */
  filter?: (result: BatchResult) => boolean;
  /**
   * Streaming callback fired once per completed prompt (success OR failure).
   * Caller exceptions are caught + logged to stderr without poisoning
   * the batch (EC-5). Bounded by `concurrency` — see its doc.
   */
  onResult?: (result: BatchResult) => void | Promise<void>;
  /** Progress callback fired after each result. */
  onProgress?: (progress: BatchProgress) => void;
  /**
   * Cancel pending prompts (ADR D140). In-flight prompts continue to
   * completion (Node `AbortSignal` semantics). When `signal.reason` is
   * an Error, it propagates to `BatchResult.error`; otherwise a generic
   * "aborted" error is used.
   */
  signal?: AbortSignal;
  /**
   * Opt-in Task wrapping (ADRs D363, D374). When set, the batch is
   * registered as a `Task` (kind="batch") in the SDK's observable
   * registry. The parent task transitions `finished` when every
   * prompt is resolved (success OR failure).
   *
   * Use cases: surfacing a long-running batch in the `theokit tasks
   * list` CLI, programmatic `Task.cancel(id)` aborting the batch, or
   * binding a user-facing job dashboard. v1 does NOT yet emit one
   * task PER prompt (single parent only); per-prompt tasks land in
   * v0.2.
   *
   * Auto-generated id uses the `b-` reserved prefix (D368, EC-5).
   *
   * @public
   */
  task?: true | { id?: string; meta?: Record<string, unknown> };
}

/**
 * Per-prompt outcome. Discriminated union — check `ok` before reading
 * `result` or `error`.
 *
 * @public
 */
export type BatchResult =
  | {
      ok: true;
      index: number;
      prompt: string;
      result: RunResult;
      metadata?: Record<string, unknown>;
      durationMs: number;
    }
  | {
      ok: false;
      index: number;
      prompt: string;
      error: TheokitAgentError;
      metadata?: Record<string, unknown>;
      durationMs: number;
    };

/**
 * Live progress snapshot delivered to `onProgress`.
 *
 * @public
 */
export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inFlight: number;
}
