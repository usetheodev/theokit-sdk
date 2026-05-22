/**
 * Public type contract for `Eval.create / .run` and the `Scorers` namespace
 * (Adoption Roadmap #2; ADRs D202-D213).
 *
 * Consumers import these types via `@usetheo/sdk` — they're re-exported
 * from the package barrel. Implementation lives in `eval.ts`, `scorers.ts`,
 * and `internal/eval/**`.
 *
 * @public
 */

import type { SDKAgent } from "./agent.js";

/** Inferred `Agent.create` options shape — avoid cycling through `AgentOptions` directly. */
export type EvalAgentOptions = Parameters<
  typeof import("../agent.js").Agent.create
>[0];

/** A single dataset row — input prompt + optional reference + free-form metadata. */
export interface DatasetEntry {
  readonly input: string;
  readonly expected?: unknown;
  readonly metadata?: Record<string, unknown>;
}

/**
 * `Dataset` is either an array OR a factory returning a (sync or async)
 * iterable (D210). The runner normalizes both shapes into an
 * `AsyncIterable<DatasetEntry>` internally.
 */
export type Dataset =
  | ReadonlyArray<DatasetEntry>
  | (() => Iterable<DatasetEntry> | AsyncIterable<DatasetEntry>);

/** Outcome of a single scoring decision. `score` in [0, 1]; the runner clamps. */
export interface Score {
  readonly score: number;
  readonly reason?: string;
}

/**
 * Scorer signature (D207). Returns `Score` synchronously OR via Promise —
 * the runner always awaits.
 */
export type Scorer = (output: string, expected?: unknown) => Score | Promise<Score>;

/** A named scorer — produced by every `Scorers.*` factory. */
export interface NamedScorer {
  readonly name: string;
  readonly score: Scorer;
}

/** Lifecycle hooks. Each fires inside a `safeHook` wrapper (EC-4); a throw never aborts the run. */
export interface EvalHooks {
  readonly beforeRun?: (info: { name: string; totalEstimate: number | undefined }) => void;
  readonly afterRow?: (row: EvalRowResult, index: number) => void;
  readonly afterRun?: (run: EvalRun) => void;
}

/** Public options for `Eval.create`. */
export interface EvalOptions {
  /**
   * Unique-per-process name for telemetry correlation + report titles.
   * Concurrent runs with the same name throw `EvalAlreadyRunningError` (D213).
   */
  readonly name: string;
  /** The dataset to evaluate. See {@link Dataset}. */
  readonly dataset: Dataset;
  /** At least one scorer. Plain `Scorer` is wrapped with an auto-name. */
  readonly scorers: ReadonlyArray<Scorer | NamedScorer>;
  /**
   * Agent to evaluate. Three accepted shapes:
   *  - `SDKAgent` instance — same agent used for every row (no state isolation).
   *  - `EvalAgentOptions` — a fresh agent is constructed per row (state isolation; default).
   *  - `(entry) => SDKAgent | Promise<SDKAgent>` — dynamic agent selection.
   */
  readonly agent:
    | SDKAgent
    | EvalAgentOptions
    | ((entry: DatasetEntry) => SDKAgent | Promise<SDKAgent>);
  /**
   * Row concurrency. Default 4 (matches `Agent.batch` D136). MUST be in
   * `[1, 64]` (EC-3 — 0 deadlocks the semaphore, Infinity DoSs the provider).
   */
  readonly concurrency?: number;
  /** Optional metadata persisted to `EvalRun.metadata` (tags, env, version). */
  readonly metadata?: Record<string, unknown>;
  /** Optional progress / lifecycle hooks. */
  readonly hooks?: EvalHooks;
}

/** Per-row outcome. */
export interface EvalRowResult {
  readonly index: number;
  readonly input: string;
  readonly output: string;
  readonly expected?: unknown;
  readonly scores: ReadonlyArray<{
    readonly name: string;
    readonly score: number;
    readonly reason?: string;
  }>;
  readonly meanScore: number;
  readonly durationMs: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly error?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Per-scorer breakdown computed across all rows. */
export interface PerScorerStats {
  readonly mean: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
}

/** Aggregate stats — the production-decision dashboard data (D211). */
export interface EvalAggregate {
  readonly meanScore: number;
  readonly medianScore: number;
  /** Ratio of rows where `meanScore >= 0.5`. */
  readonly passRatio: number;
  readonly perScorer: Record<string, PerScorerStats>;
  readonly totalRows: number;
  readonly errorRows: number;
  readonly durationMsP50: number;
  readonly durationMsP95: number;
  readonly tokensInTotal: number;
  readonly tokensOutTotal: number;
}

/** Final run result — plain serializable JSON (D209). */
export interface EvalRun {
  readonly id: string;
  readonly name: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly aggregate: EvalAggregate;
  readonly rows: ReadonlyArray<EvalRowResult>;
  readonly metadata?: Record<string, unknown>;
}

/** Per-call options for `eval.run(...)`. */
export interface EvalRunOptions {
  /** Cancels pending rows; in-flight rows complete (D140 pattern). */
  readonly signal?: AbortSignal;
}
