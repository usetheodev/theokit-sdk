# Blueprint: M6 — Eval Harness (Tema E)

> **Discovery verdict:** SHIPPABLE_WITH_CAVEATS (89.0) — research coverage 100%, reference citations 100% (0 fabricated), blueprint completeness 100%, 0 empty corners. Soft cap: `soft_floor_citation_density_low` (heuristic density floor; the blueprint carries 20+ line-exact `references/theocode-eval/` citations — accepted).
> **Slug:** `m6-eval-harness` · **Date:** 2026-06-22 · **Reference:** `knowledge-base/references/theocode-eval/`

## Context

theocode hand-rolled a SWE-bench-style eval harness (mirrored read-only under `.claude/knowledge-base/references/theocode-eval/`) that turns "agent edited a repo" into "here is the patch and it applies": a crash-durable concurrent batch runner with resume + per-line flush, a JSONL dataset loader with per-line typed errors, a git clone+checkout repo provisioner with per-instance error isolation, and a captured-`git diff` → prediction-artifact adapter. The SDK already ships the load-bearing halves — `Eval.create/run` + `Scorers` (`packages/sdk/src/eval.ts`), `SandboxBackend.execute` returning `ExecuteResult.exitCode` (`packages/sdk/src/sandbox/types.ts:11,53`), `mapWithConcurrency` (`packages/sdk/src/concurrency.ts:17`), and an `internal/persistence/` module (`packages/sdk/src/internal/persistence/`) — but lacks the glue (resume/flush, `loadJsonl`, `provisionRepo`, verify-gate-by-exit-code). This blueprint extracts the proven shapes so M6-1..M6-5 promote that plumbing first-party without reinventing crash-durability per `rules/no-stubs-no-mocks-no-wired.md` (ship wired, not stubbed) and `rules/architecture.md` § 3 (eval internals stay `@internal`; public surface minimal).

## Objective

Lock the exact first-party `@theokit/sdk` eval + sandbox API for M6-1..M6-5, grounded in theocode's hand-roll and reusing the existing `Eval`/`Scorers`/`SandboxBackend`/`mapWithConcurrency`/`internal/persistence` surface — zero new runtime dependencies.

## Coverage Corner 1 — Integration Tests

How theocode tests the harness boundaries against the real filesystem + git (Q4), and what the SDK mirrors per `rules/testing.md` § 2 (integration tests exercise real boundaries):

- **Batch resume + flush roundtrip** — `knowledge-base/references/theocode-eval/tests/swebench-batch.test.ts` drives `runSwebenchBatch` against a real temp `outJsonl`, asserting (a) each completed prediction is appended the instant it finishes and (b) a second run with `resume: true` skips already-persisted `instance_id`s. The SDK mirror exercises `appendJsonl`/`readJsonlIds` + `Eval.run({persist})` against a `mkdtemp` dir — never a mocked fs (the durability claim is only real against a real file).
- **Provision against a real git repo** — `knowledge-base/references/theocode-eval/tests/swebench-provision.test.ts` inits a real local git repo, clones+checks-out via `prepareRepo`, and asserts `ProvisionError` is thrown (not swallowed) on a bad `base_commit`. The SDK mirror does the same against `provisionRepo` + `RepoProvisionError`.
- **Dataset per-line error** — `knowledge-base/references/theocode-eval/tests/swebench-dataset.test.ts` feeds malformed JSONL and asserts the error names the offending line number. The SDK `loadJsonl` mirror asserts the `line N` message verbatim.
- **End-to-end repro** — `knowledge-base/references/theocode-eval/tests/swebench-repro.test.ts` is the full dataset→provision→run→predict→persist smoke; the SDK keeps an equivalent integration test under the `tests/integration/**` forks pool (per `CLAUDE.md` Native bindings discipline: integration tests run process-isolated).

Pattern adopted: **tmpdir + real git, no fs mocks** — matches `rules/no-stubs-no-mocks-no-wired.md` (tests may use real external services; production code stays unstubbed).

## Coverage Corner 2 — Dependencies

What the harness pulls in, and the SDK reuse that keeps M6 at **zero new runtime deps** (Q5):

- **`node:fs`** — `knowledge-base/references/theocode-eval/lib/swebench-batch.ts:17` imports `appendFileSync, mkdirSync, readFileSync, writeFileSync`; `knowledge-base/references/theocode-eval/lib/swebench-dataset.ts:8` imports `readFileSync`. → SDK places `appendJsonl`/`readJsonlIds`/`loadJsonl` in the existing `packages/sdk/src/internal/persistence/` (which already owns `atomic-write.ts`), reusing node:fs only.
- **`node:child_process` (`execFile`)** — `knowledge-base/references/theocode-eval/lib/swebench-provision.ts:7` uses `execFile` (promisified) for `git clone`/`checkout`. → SDK routes git through the existing `SandboxBackend.execute` (`packages/sdk/src/sandbox/types.ts:53`) so provisioning is portable Local/Docker/E2B without a direct child_process dep in the eval layer.
- **`mapWithConcurrency`** — `knowledge-base/references/theocode-eval/lib/swebench-batch.ts:20` imports it from theocode's own `lib/concurrency.js` (the very copy M0-2 promoted). → SDK reuses the already-public `mapWithConcurrency` (`packages/sdk/src/concurrency.ts:17`).
- **No third-party deps** — the harness uses zero npm packages beyond node builtins; the SDK promotion adds none. Confirmed by the import headers above.

## Coverage Corner 3 — Tools

The run/reproduce story + the official-Docker-harness boundary the SDK primitives must respect (Q6):

- **No-network, caller-exports-JSONL** — `knowledge-base/references/theocode-eval/lib/swebench-dataset.ts:5` documents "No network: the caller exports the HF split to JSONL and points the loader at it." The SDK `loadJsonl` is pure file I/O; fetching the dataset is the consumer's job (KISS — the SDK does not embed HF download).
- **Prediction-generation vs scoring split (Rule 9)** — `knowledge-base/references/theocode-eval/lib/swebench-provision.ts:1-6` and `swebench-batch.ts:16` are explicit: theocode generates predictions (provision → run → emit `outJsonl`) and the **official Docker SCORER consumes that JSONL separately**. The SDK verify-gate (M6-2) is therefore a *portable* exit-code scorer over `SandboxBackend.execute` for the local/CI path — it does NOT reimplement the official 3-layer Docker images.
- **Reproduce flow** — `knowledge-base/references/theocode-eval/tests/swebench-repro.test.ts` shows the invocation order: `loadSwebenchInstances(jsonl)` → `runSwebenchBatch(instances, {workRoot, outJsonl, resume})` → read `outJsonl`. The SDK exposes the same order via `loadJsonl` → `Eval.run({persist})` with the verify-gate scorer.

## Coverage Corner 4 — Techniques

The core algorithms being promoted (Q1, Q2, Q3):

- **Resume = success-only done-set + tolerant parse (M6-1)** — `knowledge-base/references/theocode-eval/lib/swebench-batch.ts:113` `readDoneIds` reads the existing `outJsonl`, counting an id "done" ONLY when its `model_patch` is non-empty (`:129`), so failed/empty rows are retried on resume; it tolerates a trailing partial line from an interrupted append (`:131-133`). → SDK `readJsonlIds(path, keyFn)` generalizes this (caller supplies the "done" predicate).
- **Per-line flush = interleave-safe sync append (M6-1)** — `knowledge-base/references/theocode-eval/lib/swebench-batch.ts:205` appends one whole `\n`-terminated JSON line the instant a row completes; `:196-202` explains why `appendFileSync` is interleave-safe (single-threaded event loop serializes; whole-line atomic) and why a persist failure is isolated (never aborts in-flight tasks). The parent dir is pre-created (`:192`) to avoid first-append ENOENT. → SDK `appendJsonl(path, record)` + `Eval.run({persist:{path,key,resume}})` flushes per row.
- **Outcome taxonomy = classify without the framework owning labels (M6-1)** — `knowledge-base/references/theocode-eval/lib/swebench-batch.ts:68` `BatchOutcome` (`clean_patch`/`no_diff`/`invalid_diff`/`infra_error`/`provision_error`) is computed at `:159-165`. → SDK exposes `classify(result) => string` so the consumer owns the taxonomy (the SDK does not hardcode SWE-bench labels — DRY/SRP).
- **Provision = clone+checkout with per-instance isolation (M6-3)** — `knowledge-base/references/theocode-eval/lib/swebench-provision.ts:37` `prepareRepo` does `git clone --quiet` then `git checkout --quiet base_commit`, throwing `ProvisionError` (`:13`) with the instance id + cause on any git failure so the batch isolates the task. → SDK `provisionRepo(sandbox, {repoUrl, ref, instanceId})` over `SandboxBackend.execute` + `RepoProvisionError`.
- **JSONL parse = split/trim/skip-blank + `line N` typed error (M6-5)** — `knowledge-base/references/theocode-eval/lib/swebench-dataset.ts:82` `parseJsonl` splits on `\n`, trims, drops blank lines, and on a bad line throws `DatasetError("line N: ...")` (`:95`,`:107`); `loadSwebenchInstances` (`:113`) layers the SWE-bench schema (`normalize`/`decodeTestList`) on top. → SDK `loadJsonl(path, {map?})` keeps the generic parse + `line N` error, and delegates the schema to the app via `map` (the SWE-bench `normalize` becomes the consumer's `map`).
- **Patch artifact = captured diff → prediction + reverse `git apply --check` (M6-2/M6-4)** — `knowledge-base/references/theocode-eval/lib/swebench-adapter.ts:48` `buildPrediction(instanceId, diff)` is the single source of truth for the prediction record; `swebench-batch.ts:154,157` builds it from the run's captured `diff` and validates well-formedness via `diffApplies(..., {reverse:true})` against the just-mutated tree (no re-clone). → SDK adds `EvalRowResult.artifact?: { diff, applies }` and `Scorers.verifyGate({failToPass, passToPass})` scoring by `ExecuteResult.exitCode` (`packages/sdk/src/sandbox/types.ts:14`).

## Cross-cutting Comparison

| M6 item | theocode hand-roll (reference) | Proposed SDK primitive | Existing SDK surface reused |
|---|---|---|---|
| M6-1 batch resume/flush | `swebench-batch.ts:113` (`readDoneIds`), `:205` (per-line flush), `:68` (`BatchOutcome`) | `appendJsonl`/`readJsonlIds` in `internal/persistence`; `Eval.run({persist:{path,key,resume}})`; `classify` hook | `internal/persistence/`, `mapWithConcurrency` (`concurrency.ts:17`), `Eval` (`eval.ts`) |
| M6-2 verify-gate scorer | scoring deferred to official Docker (`swebench-batch.ts:16`); diff validity at `:157` | `Scorers.verifyGate({failToPass,passToPass})` by exit code | `SandboxBackend.execute` (`sandbox/types.ts:53`), `ExecuteResult.exitCode` (`:14`), `Scorers` (`eval.ts`) |
| M6-3 RepoProvisioner | `swebench-provision.ts:37` (`prepareRepo`), `:13` (`ProvisionError`) | `provisionRepo(sandbox,{repoUrl,ref,instanceId})` + `RepoProvisionError` | `SandboxBackend.execute` |
| M6-4 code-runner artifact | `swebench-adapter.ts:48` (`buildPrediction`), `swebench-batch.ts:154,157` (diff + reverse apply-check) | `EvalRowResult.artifact?: {diff,applies}` | `EvalRowResult` (`types/eval.ts:91`), `SandboxBackend.execute` |
| M6-5 loadJsonl | `swebench-dataset.ts:82` (`parseJsonl`), `:95` (`line N` error) | `loadJsonl(path,{map?})` with `line N` typed error | `internal/persistence/` (node:fs) |

## ADRs

### D1 — `appendJsonl`/`readJsonlIds` live in `internal/persistence`, exposed via `Eval.run({persist})` — not a standalone public module

**Decision:** Ship the durable-JSONL primitives as `internal/persistence/jsonl.ts` (`appendJsonl`, `readJsonlIds`) and surface them to consumers through `Eval.run({persist:{path,key,resume}})` + `classify`, not as a separate top-level public subpath.

**Rationale:** `rules/architecture.md` § 3 — minimize public surface; the durability concern belongs to the eval runner, not a generic util the user wires by hand. theocode proves the flush+resume only matters inside the batch loop (`swebench-batch.ts:186-213`). KISS: one knob (`persist`) over the existing `Eval.run` rather than a new namespace.

**Alternatives considered:** public `@theokit/sdk/jsonl` subpath (rejected — YAGNI; no demand beyond eval, and it would invite the user to hand-roll the resume predicate the runner already encapsulates).

**Consequences:** the resume "done" predicate is owned by the runner via `key` + the non-empty-result rule (mirrors `readDoneIds` success-only semantics, `swebench-batch.ts:129`); consumers can't accidentally mark a failed row "done".

### D2 — Provision + verify-gate ride `SandboxBackend.execute`, never a direct `child_process` import in the eval layer

**Decision:** `provisionRepo` and `Scorers.verifyGate` issue git/test commands exclusively through `SandboxBackend.execute` (`packages/sdk/src/sandbox/types.ts:53`).

**Rationale:** `rules/architecture.md` § 2 (DIP) — the eval layer depends on the `SandboxBackend` abstraction, so the same provision/score code runs on Local/Docker/E2B (the abstraction's whole point per `sandbox/types.ts:4-6`). theocode's direct `execFile` (`swebench-provision.ts:7`) is the non-portable shortcut we deliberately improve on. Rule 9: reuse the shipped sandbox, don't reinvent process execution.

**Alternatives considered:** copy theocode's promisified `execFile` into the eval layer (rejected — non-portable, duplicates what `LocalSandbox` already does; violates DIP).

**Consequences:** `provisionRepo` takes a `sandbox` argument; tests use `LocalSandbox` against a real temp git repo (Corner 1).

### D3 — `loadJsonl` is generic; the SWE-bench schema is the consumer's `map`

**Decision:** `loadJsonl(path, {map?})` does only split/trim/skip-blank/parse + `line N` typed error (mirroring `swebench-dataset.ts:82`). The SWE-bench-specific `normalize`/`decodeTestList` (`swebench-dataset.ts:65,46`) become the consumer-supplied `map`.

**Rationale:** DRY/SRP — the SDK owns the generic, reusable parse; the dataset schema is domain-specific to SWE-bench and belongs in the app (the gap audit Seção 3.7 explicitly says "Schema SWE-bench fica no app via map"). `rules/no-stubs-no-mocks-no-wired.md`: shipping the generic loader fully-wired beats shipping a SWE-bench-coupled loader that most consumers can't reuse.

**Alternatives considered:** ship a SWE-bench-typed `loadSwebenchInstances` in the SDK (rejected — couples the harness to one benchmark; the app keeps its own `normalize`).

**Consequences:** the SDK gains a tiny, broadly reusable loader; SWE-bench consumers pass their `normalize` as `map`.

## Recommendations

Concrete API proposal per M6 item (the input to `/to-plan`):

- **M6-5 `loadJsonl`** — `export function loadJsonl<T = unknown>(path: string, opts?: { map?: (raw: Record<string, unknown>, lineNumber: number) => T }): T[]` in `internal/persistence/jsonl.ts`, re-exported from `@theokit/sdk/eval`. Typed `JsonlParseError` with `line` number (mirror `swebench-dataset.ts:95`).
- **M6-1 durable batch** — `appendJsonl(path, record)` + `readJsonlIds(path, keyFn)` in `internal/persistence/jsonl.ts`; `Eval.run({ persist?: { path: string; key: (row) => string; resume?: boolean }, classify?: (row) => string })` flushing per row (mirror `swebench-batch.ts:205`), resuming via `readJsonlIds` (mirror `:113`), reusing `mapWithConcurrency`.
- **M6-2 verify-gate** — `Scorers.verifyGate({ failToPass: string[]; passToPass: string[]; command?: (tests) => string })` running the test command via `SandboxBackend.execute` and scoring 1/0 on `exitCode === 0` (mirror split at `swebench-batch.ts:16`); add `EvalRowResult.artifact?: { diff: string; applies: boolean }`.
- **M6-3 `provisionRepo`** — `export async function provisionRepo(sandbox: SandboxBackend, opts: { repoUrl: string; ref: string; instanceId: string }): Promise<{ repoDir: string }>` + `class RepoProvisionError extends TheokitAgentError` (mirror `swebench-provision.ts:37,13`).
- **M6-4 code-runner artifact** — capture `git diff` via `SandboxBackend.execute` and validate with reverse `git apply --check` (mirror `swebench-batch.ts:157`), surfacing `{ diff, applies }` on `EvalRowResult.artifact` for the verify-gate scorer to grade.

**Blocked questions:** (none — all six answered with citations.)
