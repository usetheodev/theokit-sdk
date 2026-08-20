/**
 * Eval shape for `theokit eval` v1 (T5.1, ADR D199).
 *
 * Forward-compatible with the future `Eval.create()` API (Adoption
 * Roadmap #2). When that ships, the runner swaps internals — public
 * config shape stays the same.
 *
 * @public
 */

import type { Agent } from "@theokit/sdk";

/**
 * Outcome of a single scoring decision.
 *
 * Exported because `Scorer` — which IS public — returns it: a user writing a scorer could not name
 * its return type. Same shape as the `MemoryProviderFactory` defect in #335, one level down.
 */
export interface Score {
  /** Numeric score in [0, 1]. Use 1.0 for "pass", 0.0 for "fail". */
  readonly score: number;
  /** Optional human-readable reason for the score (shown in the report). */
  readonly reason?: string;
}

/** Scorer function — sync OR async (EC-K support). */
export type Scorer = (output: string, expected?: unknown) => Score | Promise<Score>;

/** A single dataset entry — input prompt + optional expected answer. */
export interface DatasetEntry {
  readonly input: string;
  readonly expected?: unknown;
}

/** Inferred Agent.create options shape (avoid cycling through `AgentOptions`). */
export type EvalAgentOptions = Parameters<typeof Agent.create>[0];

/** Top-level config exported from `eval.config.{ts,mjs}` (default export). */
export interface EvalConfig {
  readonly dataset: ReadonlyArray<DatasetEntry>;
  readonly scorers: ReadonlyArray<{
    readonly name: string;
    readonly score: Scorer;
  }>;
  readonly agent: EvalAgentOptions;
  /** Optional eval concurrency (default 4). */
  readonly concurrency?: number;
}

/** Per-entry result aggregated by the runner. */
export interface EvalRowResult {
  readonly input: string;
  readonly output: string;
  readonly expected?: unknown;
  readonly scores: ReadonlyArray<{
    readonly name: string;
    readonly score: number;
    readonly reason?: string;
  }>;
  readonly meanScore: number;
  readonly error?: string;
}

export interface EvalRunResult {
  readonly rows: ReadonlyArray<EvalRowResult>;
  readonly aggregate: {
    readonly meanScore: number;
    readonly passRatio: number;
    readonly totalRows: number;
    readonly errorRows: number;
  };
}
