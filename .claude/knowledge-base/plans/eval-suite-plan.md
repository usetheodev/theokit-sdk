# Plan: Eval Suite — `Eval.create/run` Public API (Adoption Roadmap #2)

> **Version 1.1 — STATUS: ✅ COMPLETE (2026-05-22).** Todos 8 phases (T0.1-T8.1) DONE. 12 ADRs D202-D213 filados. 61 unit tests PASS (SDK eval/scorers/aggregate/single-flight/dataset-iter/telemetry/llm-judge) + 63 CLI tests PASS (incluindo 5 novos pós-D212 swap). Real-LLM eval contra Ollama: **5/5 rows, mean 0.900, passRatio 100%, 0 errors**. Telegram-pro regression dogfood: 34/42 PASS (7 FAIL = OpenRouter HTTP 401 chave expirada — não regressão Eval; SDK trata erro corretamente). **Edges absorvidos: EC-1 (empty-expected), EC-2 (jsonShape OOM cap), EC-3 (concurrency validation), EC-4 (hook isolation via safeHook), EC-6 (clampScore), EC-7 (empty dataset), EC-8 (llmJudge markdown parsing), EC-10/EC-11/EC-12 documented**.

> **Version 1.0** — Ship the SDK-level eval-as-code primitive (`Eval.create({ dataset, scorers, agent }).run() → EvalRun`) that lets consumers gate production deploys on quantitative agent-quality metrics. Reuses `Agent.batch` (D134-D140) for parallelism, `Telemetry` (D34) for per-row tracing, and 5 built-in scorers (exact, contains, regex, jsonShape, llmJudge). The minimal CLI eval (D199, already shipped) swaps to consume this API internally. Outcome: every consumer of `@usetheo/sdk` can write `pnpm eval` as code, get aggregate metrics + per-row traces + cost estimate, and decide whether to ship — without paying Braintrust/LangSmith.

## Context

**What exists today:**

- **`packages/cli/src/eval/`** — minimal eval runner per ADR D199. Reads `eval.config.{ts,mjs}`, calls `Agent.batch` directly, applies sync/async scorers, writes a markdown report. Public types in `packages/cli/src/eval/types.ts` were deliberately shaped to be "forward-compatible with the future `Eval.create()` API". Theo-demo (now deleted) shipped a sample `eval.config.mjs` that mean-scored 1.000 against Ollama (3 prompts × `contains-expected` scorer) — proof the wire works.
- **`Agent.batch(prompts, options)`** (D134-D140) — fanout primitive. Returns `BatchResult[]` with per-prompt failure isolation, shared credential pool via AsyncLocalStorage, abort signal honors only pending prompts. This is the execution engine for the new Eval API.
- **`Telemetry`** (D34) — OTel spans for `agent.send`, `llm.call`, `tool.call`, `memory.search`. Privacy-by-default (`includeContent: false`). Lazy-load via `createRequire("@opentelemetry/api")` — broken exporters NEVER propagate.
- **`agentic-eval-bridge-plan.md`** — DIFFERENT plan, NOT this one. That plan covers external benchmarks (BFCL, τ²-bench, LoCoMo) — capability coverage maturity. Roadmap #2 is the EVAL-AS-CODE primitive for consumer-authored evals.

**What's missing:**

- No public `Eval` namespace in `@usetheo/sdk` (`packages/sdk/src/index.ts` line 7+ has Agent / AgentBuilder / Cron / Theokit / Security but no Eval).
- No built-in scorers — consumers re-invent regex/contains/llmJudge wheel for every eval. (CLI scaffolds one inline scorer in `eval.config.mjs` template.)
- No `EvalRun` aggregate shape — CLI computes its own minimal aggregate (`meanScore`, `passRatio`); no p50/p95 durations, no per-scorer breakdown, no token totals.
- No LLM-as-judge primitive — every consumer who needs subjective quality scoring builds it from scratch.
- No telemetry integration on eval runs — currently agent spans are emitted but the eval "session" has no parent span.

**Competitive evidence:**

- **Braintrust** ($79M Series A, 2024) — eval-as-code SDK is their core value prop. Pricing starts at $0 (community) but enterprise gates on dashboard + scorers.
- **LangSmith** (LangChain) — same shape, tied to LangChain agents. `evaluate()` + `LangSmithDataset`.
- **Helicone** — eval product launched 2025. Same `evaluate()` shape.
- **Mastra** — `mastra eval` CLI + `defineEval()` API. Closest direct analog to our target.

Per CLAUDE.md Roadmap rationale: "Sem eval-as-code (not eval-as-dashboard) ninguém vai pra produção com confiança. API alvo: `Eval.create({ dataset, scorers, agent })` retorna `EvalRun` com aggregate metrics + per-row traces. Reutiliza `Telemetry` (D34) + `agent.batch` (D134)."

## Objective

**Done = a developer writes `import { Eval, Scorers } from "@usetheo/sdk"`, calls `Eval.create({...}).run()`, gets back an `EvalRun` with aggregate metrics + per-row traces + cost summary, AND the CLI `theokit eval` invokes this API under the hood (no duplicate logic).**

Specific measurable goals:

1. `Eval` namespace exported from `@usetheo/sdk` with `Eval.create()` factory + `.run()` method.
2. `Scorers` namespace exports 5 built-ins: `exactMatch`, `containsExpected`, `regex`, `jsonShape`, `llmJudge`.
3. `EvalRun` shape includes: `aggregate` (mean, median, passRatio, perScorer, p50/p95 duration, tokensIn/Out), `rows[]` with per-row trace, `id`, `startedAt`, `endedAt`, `durationMs`.
4. `Eval.run()` consumes `Agent.batch` internally — failure-isolation per-row, abort honors pending only.
5. `llmJudge` scorer hits a REAL LLM (not fixture) — passes `Scorers.llmJudge({ model, apiKey, criteria })`.
6. Telemetry: when `telemetry.enabled = true`, the run emits a parent span `eval.run` with per-row child spans `eval.row`; LLM call spans nest under those.
7. CLI `packages/cli/src/eval/runner.ts` swaps internal loop to `Eval.create(config).run()` — public config shape (`EvalConfig`) unchanged (per D199 forward-compat promise).
8. ≥ 60 unit tests across SDK + CLI; ≥ 90% coverage on new files.
9. Real-LLM dogfood: `pnpm eval` against Ollama returns aggregate mean ≥ 0.7 on a 5-prompt sample.
10. Telegram-pro regression dogfood PASS (per `/dogfood` skill memory).

## ADRs

- **D202 — `Eval` is a static class with `Eval.create` factory + `.run()` method.**
  *Rationale:* Mirrors the `Agent.create / Agent.batch` pattern already locked in `docs.md` and consumed by every existing SDK user. Reduces cognitive overhead: any consumer who knows `Agent.create` understands `Eval.create` immediately. Alternative considered: `defineEval()` (Mastra pattern) — rejected because the SDK's API style is class-based, and adding a `define*` style would create two patterns to learn.
  *Consequences:* enables `Eval.create({...}).run()` ergonomic; constrains: result type is `Promise<EvalRun>` (not an iterator) — partial-stream API deferred to v2.

- **D203 — Built-in scorers live in a separate `Scorers` namespace exported from the SDK barrel.**
  *Rationale:* Scorers are curried factories (`Scorers.regex(pattern)` returns a `Scorer`), not Eval methods. Keeping them in their own namespace makes the import tree-shakeable (`import { Scorers } from "@usetheo/sdk"` pulls only what's used) and avoids name collisions with other Eval-namespace methods.
  *Consequences:* enables tree-shaking; constrains: third-party scorer packages should follow the same `(config) => Scorer` shape; `Scorers` namespace versioned at the SDK major.

- **D204 — Internally `Eval.run` consumes `Agent.batch` for parallelism.**
  *Rationale:* `Agent.batch` (D134-D140) already implements: failure-isolation, in-house async-semaphore (D135), credential-pool inheritance via ALS (D138), shareGPT trajectory export (D139), abort-pending-only (D140). Eval needs all of that. Re-implementing would violate DRY and create two divergent execution paths.
  *Consequences:* enables Eval to inherit Batch's correctness properties; constrains: concurrency default = Agent.batch default (4) per D136 unless `concurrency` explicitly set; Eval cannot do anything Batch can't (e.g. fancy cross-row state — not needed for v1).

- **D205 — `llmJudge` scorer is opt-in built-in and REQUIRES its own apiKey separate from the agent's.**
  *Rationale:* Using the same LLM that produced the output to also judge it is a known evaluator bias. Forcing a separate apiKey (which can point to the same provider, but is configured explicitly) makes the bias visible. Default judge model: `openai/gpt-4o-mini` per D119 (same default judge as `Agent.runUntil`).
  *Consequences:* enables LLM-as-judge with deliberate provider separation; constrains: when `llmJudge` is used, `apiKey` field is REQUIRED (TypeScript-enforced); a misconfiguration is a typecheck failure, not a runtime mistake.

- **D206 — Eval traces piggyback on `Telemetry` (D34); NO parallel tracing system.**
  *Rationale:* The SDK already has lazy-load OTel via `@opentelemetry/api` peer dep. Creating a parallel "EvalTracer" would (a) double the dep weight, (b) force consumers to wire two exporters, (c) break the "single observability surface" principle. When `AgentOptions.telemetry.enabled === true` (or `EvalOptions.telemetry`), `Eval.run` emits a parent span `eval.run` with attributes `eval.name`, `eval.rows`, and child spans `eval.row` per dataset entry; existing `agent.send` / `llm.call` spans nest correctly.
  *Consequences:* enables existing OTel collectors (Datadog, Honeycomb, etc.) to see eval runs for free; constrains: consumers without telemetry get a flat `traces?: undefined` field on EvalRun; eval has no proprietary trace format.

- **D207 — `Scorer` is `(output, expected?) => Score | Promise<Score>` (async canonical, sync sugar).**
  *Rationale:* The CLI already shipped this exact shape (`packages/cli/src/eval/types.ts:22`) via D199 + EC-K. Adopting it verbatim means D199's forward-compat promise actually holds — the CLI's `EvalConfig` becomes a strict subset of the SDK's `EvalOptions`. Async-first lets `llmJudge` (network-bound) fit the same interface as `regex` (sync).
  *Consequences:* enables zero migration cost for D199 CLI consumers; constrains: every scorer is awaited even if sync; tiny micro-overhead is irrelevant at eval scale (network-bound LLM calls dominate).

- **D208 — Error isolation per-row; one failed row NEVER aborts the run.**
  *Rationale:* Eval datasets are commonly 100-10000 rows. Aborting on the first failure throws away signal: 1 bad row out of 1000 is information, not a blocker. Mirrors `Agent.batch` D137 (failure isolation). Row failures appear in `EvalRowResult.error` and contribute `score: 0` to aggregates (not skipped — explicit fail).
  *Consequences:* enables noisy datasets to produce useful aggregates; constrains: caller must check `aggregate.errorRows` to understand quality of result; CRITICAL errors (e.g. malformed dataset) still throw before any row runs.

- **D209 — `EvalRun` is plain serializable JSON; no class methods on the result.**
  *Rationale:* Eval results need to be: persisted to disk, posted to webhooks, diffed against baselines, rendered in HTML. Class methods on the result (e.g. `run.report()`) would break all four uses. Helper functions (e.g. `Eval.toMarkdown(run)`) live as separate exports — same shape as the existing `toShareGptTrajectory` helper (line 81 of `packages/sdk/src/index.ts`).
  *Consequences:* enables direct `JSON.stringify(run)` for persistence; constrains: convenience renderers are top-level functions, not methods; consumers can build their own renderers without subclassing.

- **D210 — Dataset can be `DatasetEntry[]` OR `() => Iterable<DatasetEntry> | AsyncIterable<DatasetEntry>`.**
  *Rationale:* Production datasets are often: too large to fit in memory (millions of rows), loaded from a remote source (Postgres, Hugging Face), or streamed from a generator. Forcing an array materialization upfront would block these use cases. Async iterable is the canonical streaming shape in JS.
  *Consequences:* enables streaming datasets; constrains: when the dataset is iterable, the runner cannot know `totalRows` until exhausted — `aggregate.totalRows` is computed at end; progress events use a sliding window.

- **D211 — `aggregate` includes p50/p95 row duration + tokens-in/out totals.**
  *Rationale:* Cost-per-row and latency-per-row are the two metrics every eval consumer needs to make a deploy decision. p50 alone is insufficient (long-tail dominates user-perceived latency); p95 captures the bad-row case. Token totals enable spend forecasting at scale (e.g. "this eval would cost $40 against gpt-4o for 1000 rows").
  *Consequences:* enables direct cost/latency dashboards; constrains: runner must capture `usage.inputTokens`/`outputTokens` from each `Run.wait()` result (already populated by SDK); if a row errors before LLM call, tokens are 0 (no penalty in aggregate).

- **D212 — CLI `packages/cli/src/eval/runner.ts` swaps to call `Eval.run()` internally.**
  *Rationale:* D199 explicitly committed to "swap when Eval.run ships". Public `EvalConfig` shape stays identical — the CLI is a thin adapter from `eval.config.mjs` → `EvalOptions` → `Eval.run` → markdown report. Anything more complex duplicates the SDK.
  *Consequences:* enables one source of truth for eval execution; constrains: CLI version bumps when SDK Eval surface changes; CLI's existing 18 eval tests must continue to pass (`packages/cli/tests/eval/`).

- **D213 — `Eval.run` is single-flight per name per process; concurrent runs of the same name throw `EvalAlreadyRunningError`.**
  *Rationale:* Telemetry correlation requires unique `eval.name` attribute per span tree. Two concurrent runs with the same name would emit overlapping span trees — observability noise. Different names can run concurrently freely.
  *Consequences:* enables clean telemetry correlation; constrains: callers running matrix evals (`for model in [a, b, c]: eval.run()`) MUST give each run a unique name (e.g. include model id in name); enforcement is in-process only (multi-process needs caller coordination).

## Dependency Graph

```
Phase 0: ADRs + interface design (no code yet)
   │
   ▼
Phase 1: Core types + Eval class + builder
   │       │
   │       ▼
   │   Phase 2: Execution engine (Eval.run → Agent.batch wiring)
   │       │
   │       ▼
   │   Phase 3: Built-in scorers (exact / contains / regex / jsonShape)
   │       │       │
   │       │       ▼
   │       │   Phase 4: llmJudge scorer (real-LLM)
   │       │
   │       ▼
   │   Phase 5: Telemetry integration (D34 parent + child spans)
   │
   ▼
Phase 6: CLI swap (D199 minimal runner → consume Eval.run)
   │
   ▼
Phase 7: Docs + examples
   │
   ▼
Phase 8: Dogfood QA (real-LLM e2e + telegram-pro regression)
```

Phase 0 → 1 sequential. Phases 2-5 can run in parallel after 1 (parallel-friendly). Phase 4 depends on Phase 3 (shares Scorer interface). Phase 6 depends on 2 + 3 (CLI needs functional API). Phases 7 + 8 sequential at end.

---

## Phase 0: ADRs + Interface Design

**Objective:** Lock D202-D213 + commit zero code so subsequent phases have a stable target.

### T0.1 — File ADRs D202-D213

#### Objective
Drop one markdown file per decision in `.claude/knowledge-base/adrs/`. Each follows the existing ADR template shape (see D199 / D200 / D201 for reference).

#### Evidence
ADRs D200-D201 are the latest filed; D202+ is free. CLAUDE.md ADR table at the bottom of the file is the index — adding entries there is the only cross-cutting change.

#### Files to edit
```
.claude/knowledge-base/adrs/D202-eval-static-class.md            (NEW)
.claude/knowledge-base/adrs/D203-scorers-namespace.md            (NEW)
.claude/knowledge-base/adrs/D204-eval-consumes-batch.md          (NEW)
.claude/knowledge-base/adrs/D205-llm-judge-separate-apikey.md    (NEW)
.claude/knowledge-base/adrs/D206-eval-traces-via-telemetry.md    (NEW)
.claude/knowledge-base/adrs/D207-scorer-async-canonical.md       (NEW)
.claude/knowledge-base/adrs/D208-eval-error-isolation.md         (NEW)
.claude/knowledge-base/adrs/D209-eval-run-plain-json.md          (NEW)
.claude/knowledge-base/adrs/D210-dataset-iterable-supported.md   (NEW)
.claude/knowledge-base/adrs/D211-aggregate-p50-p95-tokens.md     (NEW)
.claude/knowledge-base/adrs/D212-cli-swaps-to-eval-run.md        (NEW)
.claude/knowledge-base/adrs/D213-eval-single-flight-per-name.md  (NEW)
CLAUDE.md                                                          (edit — append D202-D213 rows to the ADR table)
```

#### Deep file dependency analysis
- ADRs are flat markdown — no code dependency.
- CLAUDE.md ADR table is consumed by `/architecture-docs` and `/cross-validation` skills downstream. Append-only, no reorder.

#### Tasks
1. Copy ADR template from D200; one file per decision.
2. Append 12 rows to CLAUDE.md ADR table.
3. Verify markdown lints clean (`pnpm check`).

#### TDD
```
RED:     N/A — ADRs are doc-only.
VERIFY:  grep -c "^| D[2-9][0-9][0-9]" CLAUDE.md → expect 12-row delta
```

#### Acceptance Criteria
- [ ] 12 new ADR files exist in `.claude/knowledge-base/adrs/`.
- [ ] CLAUDE.md ADR table has D202-D213 rows.
- [ ] `pnpm check` clean on touched files.

#### DoD
- [ ] Tasks 1-3 done. No code yet.

---

## Phase 1: Core Types + Eval Class

**Objective:** Land the public types + the `Eval` class skeleton (no execution). Consumers can write `Eval.create({...})` and TypeScript validates the call — no runtime behavior yet.

### T1.1 — Public types + Eval class skeleton

#### Objective
Build `packages/sdk/src/eval.ts` + `packages/sdk/src/types/eval.ts` with: `EvalOptions`, `EvalRun`, `EvalRowResult`, `Scorer`, `Score`, `DatasetEntry`, `Eval` class. The `.run()` method throws `not_implemented` for this phase — wiring lands in Phase 2.

Wait — per `.claude/rules/no-stubs-no-mocks-no-wired.md`, stubs are FORBIDDEN in production code. Adjustment: Phase 1 lands the types ONLY (no class), Phase 2 lands the class wired end-to-end. The class never exists in a "not implemented" state.

#### Evidence
`no-stubs-no-mocks-no-wired.md` rule is INVIOLABLE: code that exists in the public API but throws `not_implemented` is forbidden. Phase split: T1.1 = types only (consumers can't write `Eval.create` yet — the symbol doesn't exist); T2.1 = class lands wired.

#### Files to edit
```
packages/sdk/src/types/eval.ts          (NEW — public type contract)
packages/sdk/src/index.ts                (edit — DO NOT export Eval yet; only types)
packages/sdk/tests/types/eval.test.ts   (NEW — type-only tests via `tsc --noEmit`)
docs.md                                  (edit — add §Eval Suite to the canonical contract)
```

#### Deep file dependency analysis
- **`types/eval.ts`** (NEW): pure type definitions, no imports beyond `zod` (peer) and types from `./agent.js`, `./run.js`, `./trace.js`.
- **`index.ts`**: re-export `type EvalOptions, type EvalRun, type EvalRowResult, type Score, type Scorer, type DatasetEntry` from `./types/eval.js`. NO value export of `Eval` class yet — that's T2.1.
- **`docs.md`**: append §Eval Suite section with API shape (consistent with existing §Agent + §Cron sections).

#### Deep Dives

**Type shapes (final lock-in):**

```ts
// types/eval.ts
import type { ZodType } from "zod";
import type { Agent, AgentOptions } from "./agent.js";
import type { ModelSelection, ProviderRoutingSettings } from "./agent.js";

export interface DatasetEntry {
  readonly input: string;
  readonly expected?: unknown;
  readonly metadata?: Record<string, unknown>;
}

export type Dataset =
  | ReadonlyArray<DatasetEntry>
  | (() => Iterable<DatasetEntry> | AsyncIterable<DatasetEntry>);

export interface Score {
  readonly score: number;       // [0, 1]
  readonly reason?: string;
}

export type Scorer = (output: string, expected?: unknown) => Score | Promise<Score>;

export interface NamedScorer {
  readonly name: string;
  readonly score: Scorer;
}

export interface EvalOptions {
  /** Unique name for telemetry correlation + report titles. Must be unique per-process per D213. */
  readonly name: string;
  readonly dataset: Dataset;
  readonly scorers: ReadonlyArray<Scorer | NamedScorer>;
  /**
   * Agent to evaluate. Three shapes accepted:
   *   - `Agent` instance — same agent used for every row (no state isolation).
   *   - `AgentOptions` — a fresh agent is constructed per row (state isolation, default).
   *   - `(entry) => Agent | Promise<Agent>` — dynamic agent selection (e.g. routing by entry.metadata).
   */
  readonly agent: Agent | AgentOptions | ((entry: DatasetEntry) => Agent | Promise<Agent>);
  /** Concurrency for row execution. Default 4 (matches Agent.batch). */
  readonly concurrency?: number;
  /** Optional metadata persisted to EvalRun.metadata (tags, env, version). */
  readonly metadata?: Record<string, unknown>;
  /** Optional progress / lifecycle hooks. */
  readonly hooks?: EvalHooks;
}

export interface EvalHooks {
  readonly beforeRun?: (info: { name: string; totalEstimate: number | undefined }) => void;
  readonly afterRow?: (row: EvalRowResult, index: number) => void;
  readonly afterRun?: (run: EvalRun) => void;
}

export interface EvalRowResult {
  readonly index: number;
  readonly input: string;
  readonly output: string;
  readonly expected?: unknown;
  readonly scores: ReadonlyArray<{ readonly name: string; readonly score: number; readonly reason?: string }>;
  readonly meanScore: number;
  readonly durationMs: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly error?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface EvalAggregate {
  readonly meanScore: number;
  readonly medianScore: number;
  readonly passRatio: number;   // rows where meanScore >= 0.5
  readonly perScorer: Record<string, { mean: number; median: number; min: number; max: number }>;
  readonly totalRows: number;
  readonly errorRows: number;
  readonly durationMsP50: number;
  readonly durationMsP95: number;
  readonly tokensInTotal: number;
  readonly tokensOutTotal: number;
}

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

export interface EvalRunOptions {
  readonly signal?: AbortSignal;
}

export class EvalAlreadyRunningError extends Error {
  override readonly name = "EvalAlreadyRunningError";
  constructor(public readonly evalName: string) {
    super(`Eval "${evalName}" is already running in this process. Use a unique name per concurrent run (D213).`);
  }
}
```

- **Invariants** (TypeScript-enforced):
  - `EvalOptions.name` is required and non-empty (Zod runtime check in Phase 2).
  - `EvalOptions.scorers` length ≥ 1 (eval with zero scorers is meaningless).
  - `EvalOptions.concurrency` (when set) MUST be integer in [1, 64] (EC-3 — Zod refinement; 0 deadlocks the semaphore, Infinity DoSs the provider).
  - `Score.score` MUST be in [0, 1] (Zod refinement in scorer wrappers).

- **Edge cases** (Phase 1 documents; Phase 2 enforces):
  - Empty dataset → `aggregate.totalRows = 0`, `meanScore = NaN` policy: returns 0 (not NaN) to keep aggregate serializable.
  - All rows error → `aggregate.meanScore = 0`, `errorRows = totalRows`, `passRatio = 0`.
  - Single-row dataset → p50 = p95 = that row's duration (statistical degenerate but well-defined).

#### Tasks
1. Create `types/eval.ts` with the shapes above.
2. Add re-exports in `index.ts` (types only, NO value `Eval`).
3. Append §Eval Suite to `docs.md` (mirroring §Agent style).
4. Add a `tsc --noEmit`-only test file that imports the types and constructs a literal of each shape (`tests/types/eval.test.ts`).

#### TDD
```
RED:     test_eval_options_shape_compiles() — type-only test, constructs an EvalOptions literal; fails BEFORE T1.1 lands because the type doesn't exist.
RED:     test_eval_run_shape_compiles() — constructs an EvalRun literal.
RED:     test_score_range_enforced_at_runtime() — wraps a scorer returning {score: 2}, asserts Zod refinement throws (this requires the runtime wrapper from T3.1 — so this test is parked into T3.1).
GREEN:   File types/eval.ts. Re-export from index.ts. Run `pnpm typecheck` — all green.
REFACTOR: None expected.
VERIFY:  pnpm --filter @usetheo/sdk typecheck
```

#### Acceptance Criteria
- [ ] `types/eval.ts` compiles clean.
- [ ] `index.ts` re-exports types (NOT the `Eval` value class).
- [ ] `docs.md` has §Eval Suite section.
- [ ] `tests/types/eval.test.ts` compiles (type-only).
- [ ] Pass: `pnpm typecheck` clean across SDK.
- [ ] Pass: biome lint zero warnings on touched files.

#### DoD
- [ ] Tasks 1-4 done.
- [ ] CHANGELOG entry under `[Unreleased]` `### Added`.

---

## Phase 2: Execution Engine

**Objective:** Land the `Eval` class wired end-to-end. Consumers can call `.run()` against any dataset + scorer combination and get an `EvalRun`.

### T2.1 — `Eval` class + `Eval.run()` implementation

#### Objective
Implement the runtime: `Eval.create({...})` returns an `Eval` instance; `.run()` returns `Promise<EvalRun>` after executing every dataset row via `Agent.batch` and aggregating scorer results.

#### Evidence
Per D204, the engine MUST reuse `Agent.batch`. Per D208, errors are per-row isolated. Per D213, two concurrent `run()` calls with the same `name` throw `EvalAlreadyRunningError`. CLI's existing runner (`packages/cli/src/eval/runner.ts:54`) is the reference for the row-loop shape (we extract + generalize).

#### Files to edit
```
packages/sdk/src/eval.ts                              (NEW — public Eval class)
packages/sdk/src/internal/eval/runner.ts              (NEW — execution engine)
packages/sdk/src/internal/eval/aggregate.ts           (NEW — p50/p95 + per-scorer rollup)
packages/sdk/src/internal/eval/dataset-iter.ts        (NEW — Dataset → AsyncIterable normalizer)
packages/sdk/src/internal/eval/single-flight.ts       (NEW — D213 per-name guard)
packages/sdk/src/index.ts                              (edit — value export Eval + EvalAlreadyRunningError)
packages/sdk/tests/eval/runner.test.ts                (NEW — 18+ tests)
packages/sdk/tests/eval/aggregate.test.ts             (NEW — 8+ tests)
packages/sdk/tests/eval/single-flight.test.ts         (NEW — 4+ tests)
```

#### Deep file dependency analysis
- **`eval.ts`**: thin public wrapper. `Eval.create(opts)` → validates with Zod (delegates to `parseEvalOptions`); returns `new Eval(opts)`. `instance.run(opts?)` → checks single-flight, calls `runEval(opts, this.options)`.
- **`internal/eval/runner.ts`**: the orchestrator.
  1. Normalize dataset via `dataset-iter.ts`.
  2. For each entry, build prompts array for `Agent.batch`.
  3. `Agent.batch(prompts, { concurrency, signal, getAgent: makeAgentFactory(options.agent, entry) })`.
  4. For each batch result, apply scorers (in parallel within row).
  5. Build `EvalRowResult`, push to `rows[]`.
  6. After loop, call `aggregate.ts` → assemble final `EvalRun`.
- **`internal/eval/aggregate.ts`**: pure functions — `computeAggregate(rows): EvalAggregate`. Computes p50/p95 via `quickselect` (in-house, ~30 LOC; no `simple-statistics` dep).
- **`internal/eval/dataset-iter.ts`**: `normalizeDataset(d): AsyncIterable<DatasetEntry>` — handles both array + factory-of-iterable shapes. Yields a synthetic `index` per entry.
- **`internal/eval/single-flight.ts`**: module-level `Set<string>` tracking running names. `acquire(name) | throw EvalAlreadyRunningError`; `release(name)` in `finally`. Per D213.
- **`index.ts`**: NOW value-exports `Eval` + `EvalAlreadyRunningError`.

#### Deep Dives

**Algorithm — `runEval`:**

```
1. parseEvalOptions(options) — Zod refinement, fail fast on bad config.
2. acquireSingleFlight(name) — throws EvalAlreadyRunningError if name already running.
3. const id = randomUUID();
4. const startedAt = Date.now();
5. const iter = normalizeDataset(options.dataset);
6. const entries: DatasetEntry[] = [];
7. for await (const entry of iter) entries.push({ ...entry, index: entries.length });
   (Note: materialization is acceptable for v1; streaming aggregate deferred to v2.)
8. safeHook(() => options.hooks?.beforeRun?.({ name, totalEstimate: entries.length }));
   // EC-4: hook throws are isolated via safeHook(fn) — caught + logged to stderr,
   // never propagate. Otherwise a user bug in afterRow kills the entire run.
9. const prompts = entries.map(e => e.input);
10. const batchResult = await Agent.batch(prompts, {
      concurrency: options.concurrency ?? 4,
      signal: runOpts?.signal,
      agent: (i) => resolveAgentForEntry(options.agent, entries[i]),
    });
11. for (let i = 0; i < batchResult.length; i++) {
      const entry = entries[i]; const r = batchResult[i];
      const t0 = r.startedAt; const t1 = r.finishedAt;
      if (r.ok !== true) {
        rows.push({ ...errorRow(entry, r, t1-t0) }); continue;
      }
      const output = r.result.result ?? "";
      const scoreEntries = [];
      for (const scorer of options.scorers) {
        const out = await applyScorer(scorer, output, entry.expected);
        scoreEntries.push(out);
      }
      const meanScore = scoreEntries.reduce((a, s) => a + s.score, 0) / scoreEntries.length;
      rows.push({
        index: entry.index, input: entry.input, output, expected: entry.expected,
        scores: scoreEntries, meanScore, durationMs: t1 - t0,
        tokensIn: r.result.usage?.inputTokens, tokensOut: r.result.usage?.outputTokens,
        metadata: entry.metadata,
      });
      safeHook(() => options.hooks?.afterRow?.(rows[rows.length - 1], i));  // EC-4
    }
12. const aggregate = computeAggregate(rows);
13. const endedAt = Date.now();
14. const run: EvalRun = { id, name, startedAt, endedAt, durationMs: endedAt - startedAt, aggregate, rows, metadata: options.metadata };
15. safeHook(() => options.hooks?.afterRun?.(run));  // EC-4
16. return run;
17. finally: releaseSingleFlight(name);
```

- **Invariants:**
  - `rows[i].index === i` (preserved order; `Agent.batch` already preserves it per D134).
  - `aggregate.totalRows === rows.length`.
  - `acquireSingleFlight` MUST release in `finally` even if step 7+ throws (otherwise the name is "stuck").
- **Edge cases:**
  - `entries.length === 0` → return EvalRun with all-zeros aggregate, empty rows; emit warning span.
  - All `agent.send` throw → all rows have `error`, `meanScore = 0`, `errorRows = totalRows`.
  - `scorer` returns `score > 1` or `< 0` → Zod clamps to [0, 1] AND attaches `reason: "score_out_of_range"` (defensive).

#### Tasks
1. Implement `single-flight.ts` (acquire/release + tests).
2. Implement `dataset-iter.ts` (normalizeDataset + tests).
3. Implement `aggregate.ts` (computeAggregate + p50/p95 quickselect + tests).
4. Implement `runner.ts` (runEval — the orchestrator).
5. Implement `eval.ts` (public Eval class with `create` + `run` methods + Zod validation).
6. Wire export in `index.ts`.
7. Write integration tests with `fixture-mode` agent (theo_test_* apiKey path) so the runner is exercised without real LLM calls in CI.

#### TDD
```
RED:     test_eval_create_validates_name_required() — Zod throws on empty name.
RED:     test_eval_create_validates_scorers_non_empty() — throws on scorers: [].
RED:     test_eval_create_rejects_concurrency_zero()             # EC-3
RED:     test_eval_create_rejects_concurrency_negative()         # EC-3
RED:     test_eval_create_rejects_concurrency_infinity()         # EC-3
RED:     test_eval_run_returns_evalrun_shape() — returns id, name, startedAt, endedAt, durationMs, aggregate, rows.
RED:     test_eval_run_preserves_row_index() — rows[i].index === i.
RED:     test_eval_run_single_flight_per_name() — second concurrent run() with same name throws EvalAlreadyRunningError.
RED:     test_eval_run_different_names_concurrent_ok() — two runs with different names race fine.
RED:     test_eval_error_isolation_per_row() — one row throws; aggregate.errorRows === 1, others succeed.
RED:     test_eval_empty_dataset_returns_zero_aggregate()        # EC-7 — totalRows: 0, meanScore: 0, p50/p95: 0
RED:     test_eval_dataset_as_array() — passes [{input, expected}, ...] directly.
RED:     test_eval_dataset_as_factory() — passes () => generator.
RED:     test_eval_dataset_as_async_iterable() — passes () => async generator.
RED:     test_eval_agent_as_instance() — Agent.create result; same instance per row.
RED:     test_eval_agent_as_options() — fresh agent per row when AgentOptions passed.
RED:     test_eval_agent_as_factory() — fn(entry) => Agent.
RED:     test_eval_hooks_fire_in_order() — beforeRun → afterRow×N → afterRun.
RED:     test_eval_hooks_throwing_does_not_kill_run()            # EC-4 — afterRow throws on row 3; rows 4-N still process
RED:     test_eval_abort_signal_cancels_pending_rows() — signal.abort() → no new rows; in-flight complete.
RED:     test_eval_abort_signal_before_start_releases_singleflight()  # EC-9 — abort pre-batch; next run with same name OK
RED:     test_eval_aggregate_p50_p95() — synthetic durations [10, 20, 30, 100, 200]; p50 ≈ 30, p95 ≈ 200.
RED:     test_eval_aggregate_per_scorer() — multiple scorers; aggregate.perScorer["name1"].mean correct.
RED:     test_eval_aggregate_token_totals() — sum of row tokensIn/Out correct.
RED:     test_eval_score_out_of_range_clamped() — scorer returns 2.0; row.scores[*].score === 1, reason set.
RED:     test_eval_clamps_pathological_scores()                  # EC-6 — NaN / Infinity / -5 / 2 → finite [0,1]
RED:     test_eval_handles_batch_result_without_timing_fields()  # EC-5 — durationMs falls back to 0, no NaN

GREEN:   Implement files in order: single-flight → dataset-iter → aggregate → runner → eval.ts.
REFACTOR: Extract score-clamping into `aggregate.ts`; extract agent-factory resolution into a helper.
VERIFY:  pnpm --filter @usetheo/sdk test tests/eval/
```

#### Acceptance Criteria
- [ ] 26/26 RED → GREEN.
- [ ] `Eval.create({...}).run()` returns a populated EvalRun against fixture-mode agent.
- [ ] `Eval.create({ concurrency: 0 })` throws Zod validation error (EC-3).
- [ ] `Eval.create({ concurrency: Infinity })` throws Zod validation error (EC-3).
- [ ] Hook throwing in `afterRow` does NOT abort the run; warning logged once to stderr (EC-4).
- [ ] `safeHook` wrapper centralizes hook isolation (≤ 5 LOC helper).
- [ ] Empty dataset returns `EvalRun` with `totalRows: 0`, all aggregates 0 (NOT NaN) (EC-7).
- [ ] Pathological scorer scores (NaN, ±Infinity, out-of-range) clamp to finite [0,1] (EC-6).
- [ ] Pre-`run()` abort releases single-flight; next call with same name succeeds (EC-9).
- [ ] Pass: `pnpm --filter @usetheo/sdk typecheck`.
- [ ] Pass: `pnpm --filter @usetheo/sdk test tests/eval/` 100%.
- [ ] Coverage ≥ 90% on `packages/sdk/src/internal/eval/**`.
- [ ] Biome lint zero warnings.

#### DoD
- [ ] Tasks 1-7 done. CHANGELOG entry.

---

## Phase 3: Built-in Scorers (Deterministic)

**Objective:** Ship `Scorers.exactMatch`, `Scorers.containsExpected`, `Scorers.regex`, `Scorers.jsonShape`. All sync, all in `packages/sdk/src/scorers.ts`. No LLM dep.

### T3.1 — 4 deterministic scorers + Scorers namespace

#### Objective
Curried factories: `Scorers.regex(/foo/)` returns a `Scorer` function. All take optional `caseSensitive?: boolean` (default false for `contains`, true for `exact`/`regex`). `jsonShape` accepts a Zod schema and validates the output parses to it.

#### Evidence
Every eval consumer reinvents these 4. Helicone, LangSmith, and Braintrust ship all 4 as built-ins. The CLI's existing `eval.config.mjs` template inlines `containsExpected` — proves the shape is correct.

#### Files to edit
```
packages/sdk/src/scorers.ts                (NEW)
packages/sdk/src/index.ts                  (edit — value export Scorers namespace)
packages/sdk/tests/scorers/exact.test.ts   (NEW)
packages/sdk/tests/scorers/contains.test.ts (NEW)
packages/sdk/tests/scorers/regex.test.ts   (NEW)
packages/sdk/tests/scorers/json-shape.test.ts (NEW)
```

#### Deep file dependency analysis
- **`scorers.ts`**: only depends on `zod` (peer, for `jsonShape`) and the `Score` / `NamedScorer` types from `./types/eval.js`. Zero runtime deps beyond the SDK.
- **`index.ts`**: append `export { Scorers } from "./scorers.js"`.

#### Deep Dives

```ts
// scorers.ts
import type { ZodType } from "zod";
import type { Score, NamedScorer, Scorer } from "./types/eval.js";

/** EC-2 fix: cap JSON output size to avoid OOM on runaway LLM responses. */
const JSON_SHAPE_MAX_BYTES = 1_000_000; // 1 MB

export const Scorers = {
  exactMatch(opts: { caseSensitive?: boolean } = {}): NamedScorer {
    const cs = opts.caseSensitive ?? true;
    return {
      name: "exact-match",
      score: (output, expected) => {
        if (typeof expected !== "string") return { score: 0, reason: "expected_not_string" };
        // EC-1 fix: refuse empty expected (silent false-positive trap).
        if (expected.length === 0) return { score: 0, reason: "expected_empty" };
        const o = cs ? output : output.toLowerCase();
        const e = cs ? expected : expected.toLowerCase();
        const ok = o.trim() === e.trim();
        return { score: ok ? 1 : 0, reason: ok ? undefined : "mismatch" };
      },
    };
  },
  containsExpected(opts: { caseSensitive?: boolean } = {}): NamedScorer {
    const cs = opts.caseSensitive ?? false;
    return {
      name: "contains-expected",
      score: (output, expected) => {
        if (typeof expected !== "string") return { score: 0, reason: "expected_not_string" };
        // EC-1 fix: "".includes("") is always true → silent inflated pass ratio.
        if (expected.length === 0) return { score: 0, reason: "expected_empty" };
        const o = cs ? output : output.toLowerCase();
        const e = cs ? expected : expected.toLowerCase();
        return { score: o.includes(e) ? 1 : 0, reason: o.includes(e) ? undefined : "not_found" };
      },
    };
  },
  /**
   * Regex match. The pattern is applied to LLM output, which can be
   * adversarial — passing a pattern with catastrophic backtracking
   * (e.g. `/(a+)+$/`) can hang the eval (EC-10 / ReDoS). Test your pattern
   * against worst-case strings before using in production.
   */
  regex(pattern: RegExp): NamedScorer {
    return {
      name: `regex(${pattern.source})`,
      score: (output) => {
        const ok = pattern.test(output);
        return { score: ok ? 1 : 0, reason: ok ? undefined : "regex_no_match" };
      },
    };
  },
  jsonShape<T extends ZodType>(schema: T, opts: { strict?: boolean } = {}): NamedScorer {
    return {
      name: "json-shape",
      score: (output) => {
        // EC-2 fix: cap before JSON.parse to bound memory.
        if (output.length > JSON_SHAPE_MAX_BYTES) {
          return { score: 0, reason: "output_too_large" };
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(output);
        } catch {
          return { score: 0, reason: "invalid_json" };
        }
        const result = schema.safeParse(parsed);
        if (result.success) return { score: 1 };
        return {
          score: 0,
          reason: opts.strict ? `schema_invalid: ${result.error.errors[0]?.message ?? "?"}` : "schema_invalid",
        };
      },
    };
  },
};
```

- **Invariants:**
  - Every scorer returns `Score` synchronously (Promise wrapping happens at the engine level).
  - Each scorer is referentially transparent for the same `(output, expected)` input.
- **Edge cases:**
  - `expected` is undefined for `regex` (regex doesn't need expected) → returns based on output only.
  - `output` is empty string → `exact/contains` return 0 unless expected is also "".
  - `jsonShape` with non-JSON output → `invalid_json` reason.

#### Tasks
1. Implement `scorers.ts` (~120 LOC).
2. Add 4 test files (~10 tests each).
3. Export `Scorers` from `index.ts`.

#### TDD
```
RED:     test_exact_match_case_sensitive_default()
RED:     test_exact_match_case_insensitive_opt()
RED:     test_exact_match_trims_whitespace()
RED:     test_exact_match_expected_not_string_returns_0()
RED:     test_exact_match_expected_empty_returns_0_expected_empty()  # EC-1
RED:     test_contains_case_insensitive_default()
RED:     test_contains_substring_found()
RED:     test_contains_substring_not_found()
RED:     test_contains_expected_empty_returns_0_expected_empty()      # EC-1
RED:     test_regex_matches_pattern()
RED:     test_regex_no_match()
RED:     test_regex_name_includes_pattern_source()
RED:     test_json_shape_valid_zod_object()
RED:     test_json_shape_invalid_json_returns_0_invalid_json()
RED:     test_json_shape_zod_fail_returns_0_schema_invalid()
RED:     test_json_shape_strict_reveals_error()
RED:     test_json_shape_oversize_output_returns_0_output_too_large()  # EC-2

GREEN:   Implement scorers.ts.
REFACTOR: None expected (small file).
VERIFY:  pnpm --filter @usetheo/sdk test tests/scorers/
```

#### Acceptance Criteria
- [ ] 17/17 RED → GREEN.
- [ ] `import { Scorers } from "@usetheo/sdk"` exposes all 4.
- [ ] `containsExpected({...}).score(any, "")` returns `{score: 0, reason: "expected_empty"}` (EC-1).
- [ ] `jsonShape(z.any()).score("a".repeat(1_500_000))` returns `{score: 0, reason: "output_too_large"}` (EC-2).
- [ ] `Scorers.regex` docstring documents ReDoS caveat (EC-10).
- [ ] Coverage ≥ 95% on `scorers.ts`.
- [ ] Pass: tsc + biome.

#### DoD
- [ ] Tasks 1-3 done. CHANGELOG entry.

---

## Phase 4: LLM-as-Judge Scorer

**Objective:** Ship `Scorers.llmJudge({ model, apiKey, criteria, rubric? })` — opt-in scorer that calls a SECOND LLM (judge) to score the first LLM's output (subject) against a rubric.

### T4.1 — llmJudge implementation

#### Objective
The scorer factory builds a transient Agent (no memory, no tools, no MCP) with the judge model + apiKey, calls `agent.prompt(judgePrompt)`, parses the score from the response. Returns 0 on parse failure (defensive).

#### Evidence
LLM-as-judge is the bread-and-butter of every modern eval product. Per D205, it requires a separate apiKey to make evaluator bias visible. The pattern (transient agent + parse) already exists in `Agent.runUntil` (D119) — the judge there scores `done | continue | skipped`.

#### Files to edit
```
packages/sdk/src/scorers.ts                       (edit — add llmJudge)
packages/sdk/src/internal/scorers/llm-judge.ts    (NEW — judge prompt + parser)
packages/sdk/tests/scorers/llm-judge.test.ts      (NEW — fixture + real-LLM tests)
packages/sdk/tests/scorers/llm-judge.real.test.ts (NEW — real-LLM only, gated by env)
```

#### Deep file dependency analysis
- **`internal/scorers/llm-judge.ts`**: builds judge prompt, calls `Agent.create({...transient}).prompt(judgePrompt).then(parseScore).finally(dispose)`. Reuses transient-agent pattern from `generate-object.ts`.
- **`scorers.ts`**: thin facade — exports `Scorers.llmJudge(opts)` that returns a `NamedScorer` whose `score` is `(output, expected) => llmJudgeScore({...opts, output, expected})`.

#### Deep Dives

```ts
// internal/scorers/llm-judge.ts
import { Agent } from "../../agent.js";
import type { ModelSelection, ProviderRoutingSettings } from "../../types/agent.js";
import type { Score } from "../../types/eval.js";

/**
 * Configure an LLM-as-judge scorer.
 *
 * **Cost note (EC-12):** every row with this scorer costs `1 + N` LLM calls
 * (1 for the eval agent, N for the judge — usually N=1). For a 1000-row eval
 * with both scorers + gpt-4o-mini, expect ~2x the baseline token spend. The
 * `aggregate.tokensInTotal` only reflects the EVAL agent's tokens, not the
 * judge's — keep that in mind when forecasting cost.
 *
 * **Bias note (D205):** `apiKey` is intentionally separate so callers cannot
 * accidentally judge their own output. Pass a different key (can target the
 * same provider, but the configuration is explicit).
 */
export interface LlmJudgeOptions {
  readonly model: ModelSelection;
  readonly apiKey: string;
  readonly criteria: string;
  /** Default: 0-to-1 continuous. Alternative: "discrete" → forces 0 or 1 only. */
  readonly rubric?: "continuous" | "discrete";
  readonly providers?: ProviderRoutingSettings;
}

const JUDGE_PROMPT = (subject: string, criteria: string, rubric: string, expected?: unknown) => `
You are evaluating an AI assistant's output.

CRITERIA: ${criteria}

${expected !== undefined ? `EXPECTED (reference): ${JSON.stringify(expected)}\n` : ""}
ACTUAL OUTPUT:
"""
${subject}
"""

Reply with EXACTLY this JSON object on a single line:
{"score": <number ${rubric === "discrete" ? "0 or 1" : "between 0.0 and 1.0"}>, "reason": "<one short sentence>"}

Reply with the JSON object ONLY. No preface, no explanation outside the JSON.
`.trim();

// EC-8: tolerate markdown code fences + prose around the JSON object. The
// `[\s\S]` in `reason` lets multi-line reasons through; the leading anchor is
// loose so ```json fenced output still matches.
const SCORE_REGEX = /\{\s*"score"\s*:\s*([0-9]*\.?[0-9]+)\s*,\s*"reason"\s*:\s*"([^"]*)"\s*\}/;

export async function llmJudgeScore(
  options: LlmJudgeOptions & { output: string; expected?: unknown },
): Promise<Score> {
  const rubric = options.rubric ?? "continuous";
  const prompt = JUDGE_PROMPT(options.output, options.criteria, rubric, options.expected);
  const agent = await Agent.create({
    apiKey: options.apiKey,
    model: options.model,
    local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
    ...(options.providers !== undefined ? { providers: options.providers } : {}),
  });
  try {
    const text = await agent.prompt(prompt).then((r) => (r.status === "finished" ? r.result : ""));
    const match = SCORE_REGEX.exec(text);
    if (match === null) {
      return { score: 0, reason: "judge_parse_failed" };
    }
    const raw = Number(match[1]);
    if (!Number.isFinite(raw)) {
      return { score: 0, reason: "judge_score_not_finite" };
    }
    const clamped = rubric === "discrete" ? (raw >= 0.5 ? 1 : 0) : Math.max(0, Math.min(1, raw));
    return { score: clamped, reason: match[2] };
  } finally {
    await agent.dispose();
  }
}
```

- **Invariants:**
  - Judge agent is ALWAYS disposed (try/finally).
  - Parse failure → `score: 0, reason: "judge_parse_failed"` (defensive; never throws).
  - Score outside [0, 1] → clamped (with `reason` preserved).
- **Edge cases:**
  - Judge LLM returns prose around JSON → regex still extracts the JSON object.
  - Judge LLM refuses (e.g. content filter) → returns empty result → score 0 with parse_failed.
  - Judge LLM errors (401, 429) → `agent.prompt` resolves with `status: "error"` (per D108); we return score 0 with `reason: "judge_run_failed"`.

#### Tasks
1. Implement `internal/scorers/llm-judge.ts` with judge prompt, regex parser, clamp logic.
2. Implement `Scorers.llmJudge(opts)` facade in `scorers.ts`.
3. Write fixture-mode tests (use `theo_test_*` apiKey; stub judge response).
4. Write real-LLM tests (`tests/scorers/llm-judge.real.test.ts`) gated by `OPENROUTER_API_KEY` env — these run in dogfood only, not CI.
5. Document the bias-isolation rationale (D205) in scorer docstring.

#### TDD
```
RED:     test_llm_judge_apikey_required() — TypeScript catches missing apiKey at compile-time; runtime Zod backup.
RED:     test_llm_judge_continuous_default_rubric() — fixture: judge returns {"score": 0.7, "reason": "ok"}; scorer returns 0.7.
RED:     test_llm_judge_discrete_rubric_rounds() — fixture: judge returns 0.7; discrete mode → 1.
RED:     test_llm_judge_parse_failure_returns_0() — fixture: judge returns "I cannot judge this."; scorer returns 0 with judge_parse_failed.
RED:     test_llm_judge_clamps_out_of_range() — fixture: judge returns 1.5; scorer returns 1 with reason preserved.
RED:     test_llm_judge_disposes_transient_agent() — spy on Agent.create / agent.dispose; assert dispose called.
RED:     test_llm_judge_separate_apikey_from_eval_agent() — eval agent uses key A; judge uses key B; assert different.
RED:     test_llm_judge_parses_json_in_markdown_fence()         # EC-8 — judge wraps JSON in ```json``` block, still parses
[real-LLM, gated]:
RED:     test_llm_judge_real_openrouter_gpt4omini() — real call; expects score in [0, 1].

GREEN:   Implement files.
REFACTOR: Extract JUDGE_PROMPT to a const; consider exposing it for advanced consumers.
VERIFY:  pnpm --filter @usetheo/sdk test tests/scorers/
         OPENROUTER_API_KEY=... pnpm --filter @usetheo/sdk test tests/scorers/llm-judge.real.test.ts
```

#### Acceptance Criteria
- [ ] 8/8 fixture RED → GREEN.
- [ ] 1/1 real-LLM RED → GREEN (gated; runs in dogfood phase only).
- [ ] Judge agent ALWAYS disposed (verify via spy).
- [ ] `SCORE_REGEX` parses JSON inside markdown code fences (EC-8).
- [ ] `Scorers.llmJudge` docstring documents cost-doubling caveat (EC-12).
- [ ] Coverage ≥ 90% on `internal/scorers/llm-judge.ts`.

#### DoD
- [ ] Tasks 1-5 done. CHANGELOG entry.

---

## Phase 5: Telemetry Integration

**Objective:** When `AgentOptions.telemetry.enabled === true` (passed through `EvalOptions.agent`), `Eval.run` emits a parent span `eval.run` with child `eval.row` spans; existing `agent.send` / `llm.call` spans nest under those.

### T5.1 — Telemetry parent + child span wiring

#### Objective
Use `@opentelemetry/api` lazy-load (D34 pattern). Span tree:
```
eval.run (attributes: eval.name, eval.id, eval.rows.total, eval.concurrency)
├── eval.row[0] (attributes: row.index, row.input.length, row.scores.mean)
│   ├── agent.send (existing)
│   │   ├── llm.call (existing)
│   │   └── ...
│   └── scorer.<name> (NEW) — attributes: scorer.name, scorer.score
├── eval.row[1] (...)
└── ...
eval.aggregate (attributes: aggregate.meanScore, aggregate.errorRows, aggregate.p50, aggregate.p95, aggregate.tokensInTotal)
```

#### Evidence
D34 is decided + shipped — the SDK already lazy-loads OTel. The hook point is `runEval` (Phase 2). Per D206, we MUST piggyback, not parallel-implement.

#### Files to edit
```
packages/sdk/src/internal/eval/telemetry.ts        (NEW — span helpers; lazy-load OTel)
packages/sdk/src/internal/eval/runner.ts           (edit — wrap row loop in spans)
packages/sdk/tests/eval/telemetry.test.ts          (NEW — OTel test exporter)
```

#### Deep file dependency analysis
- **`internal/eval/telemetry.ts`**: mirrors the shape of `internal/telemetry/agent-spans.ts` (already in repo per D34). Exports `withEvalRunSpan(name, id, fn)` + `withEvalRowSpan(index, fn)` + `withScorerSpan(name, fn)`. Each wraps a `safe()` to ensure span failures NEVER propagate.
- **`runner.ts`**: edit step 10 (row loop) to `await withEvalRowSpan(i, () => { ... })` and step 11 (scorer apply) to `await withScorerSpan(scorer.name, () => applyScorer(...))`.

#### Deep Dives

- **Lazy-load**: at module load, `try { trace = require("@opentelemetry/api").trace } catch { trace = undefined }`. When `trace === undefined`, all `with*Span` helpers become identity functions (`fn()`).
- **`includeContent`** (D34): if `telemetry.includeContent === true`, `eval.row` attributes include `row.input` (full text) and `row.output` (full text). Otherwise only lengths.
- **Invariants:**
  - Span operations NEVER throw upward (caught + logged once to stderr).
  - When telemetry disabled (default), runEval performance penalty < 1ms per row (no-op identity wrapper).
- **Edge cases:**
  - OTel exporter blocking → span shutdown takes < 5s; eval result is already returned to caller.
  - Bad span attribute value (e.g. circular ref in metadata) → caught, logged once, span has fewer attrs.

#### Tasks
1. Implement `internal/eval/telemetry.ts` with 3 wrappers + lazy-load.
2. Edit `runner.ts` row loop to use wrappers.
3. Write tests using OTel's `InMemorySpanExporter` (already in repo per D34 tests).

#### TDD
```
RED:     test_eval_run_emits_eval_run_span_when_telemetry_enabled()
RED:     test_eval_run_emits_eval_row_span_per_row()
RED:     test_eval_row_span_nests_under_eval_run()
RED:     test_agent_send_span_nests_under_eval_row()
RED:     test_eval_run_no_telemetry_when_disabled() — exporter sees 0 spans.
RED:     test_includeContent_off_by_default_no_input_attr()
RED:     test_includeContent_on_attaches_row_input()
RED:     test_scorer_span_attaches_score_attr()
RED:     test_otel_unavailable_eval_still_succeeds() — mock require("@opentelemetry/api") to throw; eval still returns full result.

GREEN:   Implement files.
REFACTOR: Consider exposing `Eval.toOtelLogRecord(run)` helper (out of scope v1; track for v2).
VERIFY:  pnpm --filter @usetheo/sdk test tests/eval/telemetry.test.ts
```

#### Acceptance Criteria
- [ ] 9/9 RED → GREEN.
- [ ] Span tree shape validated via InMemorySpanExporter.
- [ ] No-telemetry path overhead < 1ms/row (measured via benchmark).

#### DoD
- [ ] Tasks 1-3 done. CHANGELOG entry.

---

## Phase 6: CLI Swap (D199 → Consume Eval.run)

**Objective:** Make `packages/cli/src/eval/runner.ts` a thin adapter from `eval.config.{ts,mjs}` to `Eval.create + .run + markdown report`. Delete the duplicate loop.

### T6.1 — CLI runner refactor

#### Objective
The CLI loads the user's `eval.config.{ts,mjs}`, translates to `EvalOptions` (1:1 mapping — the shapes were designed to align per D199 forward-compat), calls `Eval.create({...}).run()`, then renders the result to markdown via `formatRunAsMarkdown(run)`.

#### Evidence
D199 explicitly committed: "Forward-compatible with the future `Eval.create()` API. When that ships, the runner swaps internals — public config shape stays the same." Phase 6 cashes that check.

#### Files to edit
```
packages/cli/src/eval/runner.ts          (edit — replace internal loop with Eval.run call)
packages/cli/src/eval/report.ts          (edit — accept EvalRun directly; remove computed-aggregate logic)
packages/cli/src/eval/types.ts           (edit — re-export SDK's EvalConfig types; drop duplicates)
packages/cli/package.json                 (edit — bump version 0.1.0 → 0.2.0)
packages/cli/CHANGELOG.md                 (edit)
packages/cli/tests/eval/runner.test.ts   (edit — assertions now match EvalRun shape)
```

#### Deep file dependency analysis
- **`runner.ts`** now: ~50 LOC (was ~120). Just adapter logic.
- **`report.ts`** now: consumes `EvalRun.aggregate` directly; no per-row recomputation.
- **`types.ts`** becomes near-empty re-export of SDK's `EvalOptions`/`EvalRun`.

#### Tasks
1. Replace `runner.ts` body with `await Eval.create(opts).run()` + format.
2. Update `report.ts` to accept `EvalRun` shape.
3. Re-run all 18 existing CLI eval tests; adjust assertions if minor diffs.
4. Bump CLI version 0.2.0 (minor — refactor visible via run output).

#### TDD
```
RED:     test_cli_eval_invokes_sdk_eval_run() — spy on Eval.create / run; assert called once with parsed config.
RED:     test_cli_eval_markdown_report_includes_aggregate_section() — output contains "Mean score" + "Pass ratio" + "Total rows".
RED:     test_cli_eval_existing_18_tests_still_pass() — regression check on the 18 prior tests.
RED:     test_cli_eval_outputs_p50_p95_when_available() — new fields surfaced.

GREEN:   Refactor files.
REFACTOR: Drop dead code: in-CLI `applyScorer`, `extractUsage` (now in SDK).
VERIFY:  pnpm --filter @usetheo/cli test tests/eval/
```

#### Acceptance Criteria
- [ ] 4/4 RED → GREEN.
- [ ] All 18 existing CLI eval tests still pass.
- [ ] CLI version bumped + CHANGELOG entry.
- [ ] `theokit eval --config <path>` smoke against fixture mode passes.

#### DoD
- [ ] Tasks 1-4 done.

---

## Phase 7: Docs + Examples

**Objective:** Land `examples/eval/` with a runnable real-LLM example + update `docs.md` §Eval Suite + add a "Migrating from CLI eval to SDK Eval" section to CHANGELOG.

### T7.1 — Examples + docs

#### Objective
- `examples/eval/` — new example dir with `eval.config.mjs` (5 prompts × 2 scorers) + `package.json` + README.
- `docs.md` §Eval Suite gets API reference + 3 worked examples.
- CHANGELOG `### Added` entry for the full Eval+Scorers surface.

#### Files to edit
```
examples/eval/.env.example          (NEW)
examples/eval/package.json          (NEW)
examples/eval/README.md             (NEW)
examples/eval/eval.config.mjs       (NEW)
examples/eval/run.ts                (NEW — invokes Eval directly, no CLI)
docs.md                              (edit — §Eval Suite reference)
packages/sdk/CHANGELOG.md           (edit)
```

#### Tasks
1. Build the example with 5 prompts + `containsExpected` + `llmJudge` scorers.
2. Document API in `docs.md` mirroring §Agent style.
3. Add migration note for D199 CLI users.
4. In `examples/eval/README.md` + `docs.md` §Eval Suite, add scale note: "v1 materializes the dataset in memory; recommended ceiling ~10k rows. For larger datasets, partition into multiple `Eval.run` calls or wait for streaming aggregate (v2)." (EC-11)
5. In `docs.md` §Eval Suite cost-forecasting subsection, document that `llmJudge` doubles per-row cost (EC-12); show worked example: `1000 rows × gpt-4o-mini ≈ $1.50 base + $1.50 judge = $3.00`.

#### Acceptance Criteria
- [ ] `examples/eval/run.ts` runs clean against Ollama (real LLM, no fixture).
- [ ] `docs.md` §Eval Suite is the canonical reference.
- [ ] CHANGELOG entry references all 13 ADRs (D202-D213) + the SDK surface.

#### DoD
- [ ] Tasks 1-3 done.

---

## Phase 8: Dogfood QA (MANDATORY)

**Objective:** Real-LLM end-to-end validation + telegram-pro regression check.

### T8.1 — Real-LLM Eval + Telegram-Pro dogfood

#### Acceptance Criteria
1. `examples/eval/run.ts` runs against Ollama (`llama3.2:3b`) — aggregate `meanScore ≥ 0.7` on the 5-prompt sample.
2. Same example with `llmJudge` scorer enabled (using OpenRouter gpt-4o-mini) — produces valid `0..1` scores; aggregate ≥ 0.6.
3. CLI smoke: `cd examples/eval && pnpm exec theokit eval --config eval.config.mjs` — produces markdown report with the new shape.
4. **`/dogfood` skill** invocation (mandatory per memory `feedback_dogfood_after_plan`): full telegram-pro suite, expect `PASS ≥ 38/42` (allow ≤ 4 flaky for unrelated reasons like rate-limit; document them).
5. Zero CRITICAL issues caused by this plan in either dogfood.

### If Dogfood Fails

1. Identify which fails are caused by this plan vs pre-existing (e.g. OpenRouter 401 = credential issue, not Eval bug).
2. Fix plan-caused CRITICAL/HIGH issues; re-run.
3. Document pre-existing issues but they don't block plan completion.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No `Eval` namespace in SDK | T1.1 + T2.1 | `Eval.create()` + `.run()` shipped |
| 2 | No built-in scorers | T3.1 + T4.1 | `Scorers.{exactMatch,contains,regex,jsonShape,llmJudge}` |
| 3 | No `EvalRun` aggregate shape | T2.1 (aggregate.ts) | p50/p95 + per-scorer + token totals |
| 4 | No LLM-as-judge primitive | T4.1 | `Scorers.llmJudge({...})` |
| 5 | No telemetry on eval runs | T5.1 | parent + child spans via D34 |
| 6 | CLI duplicates loop | T6.1 | CLI swaps to `Eval.run()` per D212 |
| 7 | No real-LLM eval example | T7.1 | `examples/eval/` shipped |
| 8 | Concurrent runs would clash telemetry | T2.1 (single-flight) | `EvalAlreadyRunningError` per D213 |
| 9 | Dataset can't be streaming | T2.1 (dataset-iter) | Array OR factory-of-iterable per D210 |
| 10 | Bias when judge = subject | T4.1 (D205) | Separate `apiKey` required, type-enforced |
| 11 | No public types for consumers | T1.1 | `EvalOptions`, `EvalRun`, etc. exported |
| 12 | Error in one row aborts everything | T2.1 (D208) | Per-row isolation via Agent.batch |
| 13 | Cost forecasting | T2.1 (aggregate D211) | `tokensInTotal` / `tokensOutTotal` |

**Coverage: 13/13 gaps (100%)**

### Edge cases absorbed (from `eval-suite-edge-cases-2026-05-22.md`)

| # | Edge case | Task(s) | Resolution |
|---|---|---|---|
| EC-1 | `containsExpected` / `exactMatch` empty-expected loophole | T3.1 | Refuse empty expected with `reason: "expected_empty"` |
| EC-2 | `jsonShape` OOM on giant output | T3.1 | Cap at 1 MB; return `"output_too_large"` |
| EC-3 | `concurrency` 0 / negative / Infinity | T2.1 | Zod refinement `int().min(1).max(64)` |
| EC-4 | Hook throw kills entire run | T2.1 | `safeHook(fn)` try/catch wrapper |
| EC-5 | `BatchResult` missing timing fields | T2.1 | RED test; durationMs falls back to 0 |
| EC-6 | Pathological scores (NaN/Infinity/out-of-range) | T2.1 | RED test; clamp to finite [0,1] |
| EC-7 | Empty dataset degenerate aggregate | T2.1 | RED test; all-zeros (not NaN) |
| EC-8 | Judge JSON inside markdown fence | T4.1 | Relaxed `SCORE_REGEX` + RED test |
| EC-9 | Abort before `run()` leaks single-flight | T2.1 | RED test; finally{ release } |
| EC-10 | ReDoS in `Scorers.regex` (user-supplied pattern) | T3.1 | DOCUMENT in docstring |
| EC-11 | Eager materialization OOM at scale | T7.1 | DOCUMENT in README + docs.md ("≤10k rows for v1") |
| EC-12 | `llmJudge` cost doubling | T4.1 | DOCUMENT in docstring + cost worked example in docs.md |

**Edge case coverage: 12/12 (100%)**

## Global Definition of Done

- [ ] All 8 phases completed.
- [ ] All tests passing: `pnpm --filter @usetheo/sdk test` + `pnpm --filter @usetheo/cli test`.
- [ ] Zero Biome lint warnings on touched files (`packages/sdk/src/eval.ts`, `internal/eval/**`, `scorers.ts`, `internal/scorers/**`).
- [ ] `pnpm typecheck` clean across SDK + CLI.
- [ ] Backward compatibility: existing `Agent`, `Cron`, `Theokit`, `Security` surfaces unchanged.
- [ ] D202-D213 ADRs filed.
- [ ] CHANGELOG entries on SDK + CLI.
- [ ] `docs.md` §Eval Suite is the canonical reference.
- [ ] Coverage ≥ 90% on all new files (run `pnpm coverage`).
- [ ] **Dogfood QA PASS**: real-LLM eval mean ≥ 0.7 + telegram-pro suite ≥ 38/42 PASS.
- [ ] **Runtime-metric proof**: `aggregate.tokensInTotal > 0` AND `aggregate.durationMsP95 > 0` observed in a real workload (not a synthetic test).

## Final Phase: Dogfood QA (MANDATORY)

See Phase 8. Plan is NOT done until both dogfoods pass.

### Execution

```bash
# 1. SDK + CLI tests
pnpm --filter @usetheo/sdk test
pnpm --filter @usetheo/cli test

# 2. Real-LLM eval (Ollama)
cd examples/eval && pnpm exec tsx run.ts

# 3. Real-LLM eval with LLM judge (OpenRouter)
export OPENROUTER_API_KEY=...
cd examples/eval && pnpm exec tsx run.ts --judge

# 4. CLI smoke
pnpm --filter @usetheo/cli exec theokit eval --config examples/eval/eval.config.mjs

# 5. Telegram-pro regression (per /dogfood skill memory)
node .claude/skills/dogfood/lib/dogfood.mjs --user-id <id>
```

### Acceptance Criteria

- [ ] All 5 steps PASS.
- [ ] Zero CRITICAL issues introduced by this plan in either dogfood.
- [ ] Pre-existing issues (e.g. OpenRouter 401 credential issues) documented separately; don't block.

---

## Out of Scope (v1.0)

- **Eval streaming** — `Eval.runStream` that yields per-row results. Add when consumers ask (probably v1.1).
- **Eval datasets in remote stores** — `Dataset.fromHuggingFace(id)`, `Dataset.fromPostgres(query)`. v1 supports arrays + factories; remote loaders are consumer responsibility for v1.
- **Eval diff against baseline** — `Eval.compare(runA, runB)`. Adjacent to the v2 reporting layer.
- **Distributed eval (multi-machine)** — single-process for v1. Multi-machine needs a coordinator (out of SDK scope).
- **Built-in dashboards / UI** — eval output is `EvalRun` JSON; consumers render. We don't ship a dashboard (deliberate per Roadmap rationale).
- **Pricing-per-model token cost calculator** — `aggregate.tokensInTotal` is the raw signal; mapping to $$ is provider-specific config (out of v1).

## Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `Agent.batch` semantic changes break Eval consumer | Low | High | Reuses public `Agent.batch` API; pin tests against the contract. |
| `@opentelemetry/api` peer dep version skew | Med | Low | Lazy-load + safe() wrap per D34; broken exporter → log once, continue. |
| LLM-judge prompt regression (model behaves differently across providers) | High | Med | JUDGE_PROMPT exposed as constant for advanced override; SCORE_REGEX is generous (extracts even when model wraps in prose). |
| Eval performance vs other tools (Braintrust ~50ms/row baseline overhead) | Med | Low | Telemetry off by default; no-OTel overhead < 1ms; benchmark in `tests/eval/perf.test.ts`. |
| Multi-process eval clashes on `name` despite in-process guard (D213) | Low | Low | Documented limitation; D213 explicit about in-process scope; caller coordinates if needed. |
