/**
 * Public `Eval` namespace (Adoption Roadmap #2, ADRs D202-D213).
 *
 * Usage:
 *
 *   import { Eval, Scorers } from "@theokit/sdk/eval";
 *   const run = await Eval.create({
 *     name: "qa-smoke",
 *     dataset: [{ input: "Say ok", expected: "ok" }],
 *     scorers: [Scorers.containsExpected()],
 *     agent: { apiKey: process.env.OPENROUTER_API_KEY, model: { id: "openai/gpt-4o-mini" } },
 *   }).run();
 *   console.log(run.aggregate.meanScore);
 *
 * @public
 */

// Bootstrap import: loading this facade must register the public Agent facade
// into the agent-factory-registry seam, because `internal/eval/runner.ts` and
// `internal/scorers/llm-judge.ts` resolve it via `getAgentFacade()` at runtime
// instead of importing `agent.ts` directly (which would invert the
// public-api -> internal dependency direction). The `@theokit/sdk/eval`
// sub-path entry would otherwise throw "Agent facade not registered".
import "./agent.js";
import { z } from "zod";
import { runEval } from "./internal/eval/runner.js";
import type { EvalOptions, EvalRun, EvalRunOptions } from "./types/eval.js";

const EvalOptionsSchema = z.object({
  name: z.string().min(1, "Eval.name must be non-empty"),
  // dataset / scorers / agent are validated lightly here; deep validation is
  // structural and lives in the runner (where it's cheap to do once).
  dataset: z.unknown().refine((v) => Array.isArray(v) || typeof v === "function", {
    message:
      "dataset must be an array of DatasetEntry OR a factory returning Iterable/AsyncIterable",
  }),
  scorers: z.unknown().refine((v) => Array.isArray(v) && v.length >= 1, {
    message: "scorers must be an array with at least one scorer",
  }),
  agent: z.unknown().refine((v) => v !== undefined && v !== null, {
    message: "agent must be an SDKAgent, AgentOptions, or factory function",
  }),
  // EC-3: concurrency MUST be a finite integer in [1, 64]. Bare `z.number()`
  // would let Infinity / 0 / negatives slip through.
  concurrency: z
    .number()
    .int("concurrency must be an integer")
    .min(1, "concurrency must be >= 1")
    .max(64, "concurrency must be <= 64")
    .optional(),
  // SE41: trials MUST be a finite integer in [1, 100]. Guards against 0
  // (no-op run) and unbounded fanout that would DoS the provider.
  trials: z
    .number()
    .int("trials must be an integer")
    .min(1, "trials must be >= 1")
    .max(100, "trials must be <= 100")
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  hooks: z
    .object({
      beforeRun: z.function().optional(),
      afterRow: z.function().optional(),
      afterRun: z.function().optional(),
    })
    .partial()
    .optional(),
});

/**
 * One eval definition — a dataset, at least one scorer, and the agent under test.
 * `Eval.create(options)` validates and returns an instance; `.run()` executes it
 * and resolves an {@link EvalRun}.
 *
 *   import { Eval, Scorers } from "@theokit/sdk/eval";
 *   const run = await Eval.create({
 *     name: "qa-smoke",
 *     dataset: [{ input: "Say ok", expected: "ok" }],
 *     scorers: [Scorers.containsExpected()],
 *     agent: { apiKey: process.env.OPENROUTER_API_KEY, model: { id: "openai/gpt-4o-mini" } },
 *   }).run();
 *   console.log(run.aggregate.meanScore);
 *
 * Needs a usable agent — an `SDKAgent`, an `AgentOptions` object, or a factory —
 * which in practice means live provider credentials. Import from
 * `@theokit/sdk/eval`: loading that entry is also what registers the `Agent`
 * facade the runner resolves at call time.
 *
 * How it fails:
 *  - `Eval.create` THROWS a `ZodError` on bad options: empty `name`, `scorers` not
 *    a non-empty array, missing `agent`, `concurrency` outside 1..64, `trials`
 *    outside 1..100. Non-integers and `Infinity` are rejected, never coerced.
 *  - `run()` rejects with `EvalAlreadyRunningError` when another run with the SAME
 *    `name` is in flight in this process. The guard is a module-level set keyed on
 *    the name, so two independently created `Eval`s that happen to share a name
 *    collide with each other.
 *  - A row that throws does NOT reject `run()`. It is isolated and recorded in
 *    `run.rows`, so a resolved promise does not mean every row succeeded — read
 *    `aggregate` / `rows`, or use `assertEval` to turn thresholds into a throw
 *    for CI.
 *
 * Trap: `Eval.create` only checks that `dataset`, `scorers` and `agent` are the
 * right KIND of value. A malformed dataset entry or an unreachable provider
 * surfaces later, per row, inside the run.
 *
 * @public
 */
export class Eval {
  private constructor(private readonly options: EvalOptions) {}

  /**
   * Construct an Eval. Throws on bad options (empty name, concurrency
   * out of range, empty scorers, etc).
   */
  static create(options: EvalOptions): Eval {
    EvalOptionsSchema.parse(options);
    return new Eval(options);
  }

  /**
   * Run the eval. Resolves with a populated {@link EvalRun}. Per D208,
   * row errors are isolated; per D213, two runs with the same name
   * throw `EvalAlreadyRunningError`.
   */
  run(runOpts?: EvalRunOptions): Promise<EvalRun> {
    return runEval(this.options, runOpts);
  }
}

// SE41: the CI gate — assert a run meets score/error thresholds or throw.
export { assertEval, EvalThresholdError } from "./internal/eval/assert.js";
// M6-4: capture an agent's code change as a gradeable artifact (git diff + reverse apply-check).
export { captureArtifact } from "./internal/eval/code-runner.js";
export { EvalAlreadyRunningError } from "./internal/eval/single-flight.js";
// M6-5: generic JSONL dataset loader (schema delegated to the caller's `map`, ADR D3).
export { JsonlParseError, loadJsonl } from "./internal/persistence/jsonl.js";
export { Scorers } from "./scorers.js";
export type * from "./types/eval.js";
