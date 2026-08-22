/**
 * The shape of `eval.config.{ts,mjs}`, consumed by `theokit eval` (T5.1, ADR D199).
 *
 * ```ts
 * import type { EvalConfig } from "@theokit/cli";
 *
 * export default {
 *   agent: { model: "gpt-4o-mini" },
 *   dataset: [{ input: "2+2?", expected: "4" }],
 *   scorers: [{ name: "exact", score: (out, exp) => ({ score: out.trim() === exp ? 1 : 0 }) }],
 * } satisfies EvalConfig;
 * ```
 *
 * The runner now delegates to the SDK's `Eval.create().run()` (D212); this shape survived that swap
 * unchanged, which is what D199 was for.
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

/**
 * Grades one agent output. May be sync or async (EC-K); both are awaited.
 *
 * `expected` is whatever the dataset entry carried, `unknown` because nothing constrains it — narrow
 * it yourself. It is `undefined` for entries that declared no `expected`, so a scorer that assumes a
 * string has to handle that.
 *
 * Scoring runs inside the SDK's eval engine, which reports per-ROW failures: a failed row carries an
 * `error` and is counted in `errorRows` rather than aborting the suite.
 */
export type Scorer = (output: string, expected?: unknown) => Score | Promise<Score>;

/**
 * One evaluation case: the prompt sent to the agent, and an optional expected value handed to every
 * scorer untouched (no comparison is performed for you).
 */
export interface DatasetEntry {
  readonly input: string;
  readonly expected?: unknown;
}

/**
 * The `Agent.create()` options object, inferred from the installed `@theokit/sdk` rather than
 * re-declared. Whatever that version accepts — model, tools, plugins — is accepted here.
 */
export type EvalAgentOptions = Parameters<typeof Agent.create>[0];

/**
 * The DEFAULT export of `eval.config.{ts,mjs}`. A named export is not read.
 *
 * `theokit eval` checks only that `dataset` and `scorers` are arrays and `agent` is an object; every
 * deeper mistake surfaces at run time, from the SDK, per row. An empty `dataset` is accepted and
 * short-circuits to a zero-row report — the run costs nothing and proves nothing.
 *
 * Running it spends real money: each entry is one live agent turn against the configured provider.
 */
export interface EvalConfig {
  /** Cases to run, in order. Empty is legal and produces an empty report. */
  readonly dataset: ReadonlyArray<DatasetEntry>;
  /** Scorers applied to EVERY row. `name` is the column label in the markdown report. */
  readonly scorers: ReadonlyArray<{
    readonly name: string;
    readonly score: Scorer;
  }>;
  /** Options for the agent under test — one agent config for the whole suite. */
  readonly agent: EvalAgentOptions;
  /**
   * Rows evaluated in parallel. Omitted means the key is not forwarded at all, so the SDK's own
   * default applies. Raise it and you raise your provider rate-limit exposure with it.
   */
  readonly concurrency?: number;
}

/**
 * One row of the report. `meanScore` averages this row's scorers.
 *
 * `error` present means the row failed: `output` is then an empty-ish placeholder and `scores` is
 * not meaningful. The markdown report renders such a row as `*error*`.
 */
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

/**
 * The whole suite result, copied field-for-field from the SDK's eval aggregate (the SDK's richer
 * fields — latency percentiles, token counts — are dropped at this boundary).
 *
 * `passRatio` is a ratio in [0, 1]; the markdown report labels it "Pass ratio (>=0.5)".
 */
export interface EvalRunResult {
  readonly rows: ReadonlyArray<EvalRowResult>;
  readonly aggregate: {
    readonly meanScore: number;
    readonly passRatio: number;
    readonly totalRows: number;
    readonly errorRows: number;
  };
}
