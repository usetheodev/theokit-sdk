---
slug: m6-eval-harness
milestone_id: M6
created_at: 2026-06-22
goal: Ship the @theokit/sdk eval-harness primitives (loadJsonl, durable batch persist/resume, provisionRepo, verifyGate, artifact) so a SWE-bench-style run is crash-durable and gradeable.
---

# Plan: M6 — Eval Harness (Tema E)

> **Version 1.0** — Promote theocode's hand-rolled SWE-bench harness plumbing to first-party `@theokit/sdk` eval + sandbox primitives (M6-1..M6-5), reusing the existing `Eval`/`Scorers`/`SandboxBackend`/`mapWithConcurrency`/`internal/persistence` surface with zero new runtime dependencies. Grounded in `knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md "Recommendations"` (`knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md`, SHIPPABLE_WITH_CAVEATS 89.0).

## Goal

> Enable `@theokit/sdk/eval` consumers to run a crash-durable, gradeable SWE-bench-style eval (loadJsonl → provisioned repo → agent → resumable batch → verify-gate) so that a crashed multi-hour run resumes without re-paying completed work and a patch is graded by test exit-code, measured by the M6 integration test suite (`packages/sdk/tests/eval/m6-eval-harness.test.ts`) passing green.

## Context

The gap audit (`docs/gap-audit/THEOKIT_GAP_AUDIT.md` Seção 3.7) flags five eval-harness gaps (M6-1..M6-5). theocode hand-rolled all of them (mirrored read-only at `.claude/knowledge-base/references/theocode-eval/`); the discovery blueprint (`knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md`) extracted the proven shapes and locked the SDK API per `knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md "Recommendations"`. The SDK already ships `Eval.create/run` + `Scorers` (`packages/sdk/src/eval.ts`), `SandboxBackend.execute` returning `ExecuteResult.exitCode` (`packages/sdk/src/sandbox/types.ts:11`), `mapWithConcurrency` (`packages/sdk/src/concurrency.ts:17`), and an `internal/persistence/` module — this plan adds the missing glue without new dependencies, per `rules/no-stubs-no-mocks-no-wired.md` (ship wired) and `rules/architecture.md` § 3 (minimal public surface).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/persistence/jsonl.ts` (NEW) | 0 | — | (file to be created — durable JSONL primitives) | — |
| `packages/sdk/src/internal/persistence/jsonl.test.ts` (NEW) | 0 | — | (RED tests) | — |
| `packages/sdk/src/eval.ts` | 86 | `d92f2b7` (2026-06-18) | Public `Eval` facade (`create`/`run`) + re-exports `Scorers` | `Eval.create(options)` + `Eval.run(runOpts?)` signatures stay backward-compatible; `EvalOptionsSchema` still validates |
| `packages/sdk/src/types/eval.ts` | 148 | `b70747b` (2026-06-03) | Public type contract for Eval/Scorers | Existing `EvalRowResult`/`EvalRunOptions`/`Scorer` fields stay; new fields are OPTIONAL (additive) |
| `packages/sdk/src/internal/eval/runner.ts` | 339 | `d92f2b7` (2026-06-18) | `runEval` — dataset→agent→scorer loop with concurrency + row-error isolation | Row-error isolation + single-flight guard preserved (existing runner behavior); persist is additive |
| `packages/sdk/src/scorers.ts` | 151 | `b70747b` (2026-06-03) | `Scorers` namespace (exactMatch/containsExpected/...) | Existing scorers unchanged; `verifyGate` is additive |
| `packages/sdk/src/sandbox/provision.ts` (NEW) | 0 | — | (file to be created — repo provisioner) | — |
| `packages/sdk/src/sandbox/index.ts` | 8 | `540b570` (2026-06-10) | sandbox public barrel | existing exports unchanged; `provisionRepo`/`RepoProvisionError` added |
| `packages/sdk/src/sandbox/types.ts` | 112 | `540b570` (2026-06-10) | `SandboxBackend`/`ExecuteResult` contract | `execute`/`ExecuteResult` unchanged (reused, not modified) |
| `packages/sdk/src/internal/eval/code-runner.ts` (NEW) | 0 | — | (file to be created — git diff capture + reverse apply-check) | — |
| `packages/sdk/tests/eval/m6-eval-harness.test.ts` (NEW) | 0 | — | (integration test for M6) | — |

Every file in any task's `#### Files to edit` appears above.

### Current callers / dependents

- **Symbol:** `Eval.run()` in `packages/sdk/src/eval.ts` → `runEval()` in `packages/sdk/src/internal/eval/runner.ts`
  - Callers (production): `packages/sdk/src/eval.ts:79` (facade delegates)
  - Callers (tests): `packages/sdk/tests/eval/*` (existing eval tests)
  - External (public API consumed by other repos): yes — `@theokit/sdk/eval` is published; new options are ADDITIVE (optional) so the contract is backward-compatible.
- **Symbol:** `Scorers` in `packages/sdk/src/scorers.ts` (object literal, `:56`)
  - Callers (production): `packages/sdk/src/eval.ts` re-export
  - Callers (tests): existing scorer tests
  - External: yes — additive (`verifyGate` is a new key).
- **Symbol:** `SandboxBackend.execute` in `packages/sdk/src/sandbox/types.ts:53`
  - Callers (production): `packages/sdk/src/sandbox/local-sandbox.ts`
  - Used-by (new): `provisionRepo`, `verifyGate`, code-runner — they DEPEND ON it (reuse), do not modify it.

Enumerated via `grep -rln`. Citations resolve.

### Domain glossary

- **prediction / patch** — the unified `git diff` an agent produced for an instance; the gradeable artifact.
- **verify-gate** — scoring a patch by running the project's tests and reading the process exit code (0 = pass).
- **resume** — skipping instances already persisted with a successful (non-empty) result in the output JSONL.
- **FAIL_TO_PASS / PASS_TO_PASS** — SWE-bench test lists that must flip to passing / stay passing after the patch.
- **per-line flush** — appending one whole `\n`-terminated JSON record the instant a row completes, so a crash never discards completed work.

### Architecture boundaries affected

- `rules/architecture.md` § 2 (DIP): the eval layer depends on the `SandboxBackend` abstraction (provision/verify-gate ride `execute`) — direction is eval → sandbox-abstraction, never eval → concrete child_process (D2).
- `rules/architecture.md` § 3 (module cohesion): durable-JSONL primitives live in `internal/persistence` (private); the public surface grows only by additive optional fields on `Eval`/`Scorers`/`EvalRowResult` (D1).

## Prior Art & Related Work

- **Internal blueprint** — `knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md "Recommendations"` and `knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md "Cross-cutting Comparison"` in `knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89.0) specify the exact API per M6 item.
- **Reference project** — `knowledge-base/references/theocode-eval/lib/swebench-batch.ts:113,205,68` (resume/flush/taxonomy), `swebench-provision.ts:37,13` (clone+checkout, ProvisionError), `swebench-dataset.ts:82,95` (parseJsonl, line-N error), `swebench-adapter.ts:48` (buildPrediction).
- **Existing SDK surface reused** — `packages/sdk/src/concurrency.ts:17` (`mapWithConcurrency`, promoted in M0-2), `packages/sdk/src/sandbox/types.ts:53` (`SandboxBackend.execute`), `packages/sdk/src/internal/persistence/index.ts` (persistence home).

## Objective

- [ ] Sub-goal 1 (M6-5) — `loadJsonl(path, {map?})` parses JSONL with `line N` typed errors; SWE-bench schema delegated to caller's `map`.
- [ ] Sub-goal 2 (M6-1) — `appendJsonl`/`readJsonlIds` + `Eval.run({persist:{path,key,resume}, classify?})` flush per row + resume skips done ids.
- [ ] Sub-goal 3 (M6-3) — `provisionRepo(sandbox,{repoUrl,ref,instanceId})` clones+checks-out via `SandboxBackend.execute`; throws `RepoProvisionError` on git failure.
- [ ] Sub-goal 4 (M6-4) — code-runner captures `git diff` + reverse `git apply --check`, surfacing `EvalRowResult.artifact?: {diff,applies}`.
- [ ] Sub-goal 5 (M6-2) — `Scorers.verifyGate({failToPass,passToPass})` scores by `ExecuteResult.exitCode`.

## ADRs

### D1 — Durable-JSONL primitives in `internal/persistence`, surfaced via `Eval.run({persist})`

**Decision:** Ship `appendJsonl`/`readJsonlIds`/`loadJsonl` in `internal/persistence/jsonl.ts`; expose resume/flush to consumers only through `Eval.run({persist:{path,key,resume}, classify?})`. `loadJsonl` is re-exported from `@theokit/sdk/eval` (it is the dataset-input side consumers call directly).

**Rationale:** `rules/architecture.md` § 3 — minimize public surface; durability belongs to the eval runner (`knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md "ADRs" D1`). KISS: one `persist` knob over the existing `Eval.run`.

**Alternatives considered:** public `@theokit/sdk/jsonl` subpath (rejected — YAGNI; no demand beyond eval, and it invites hand-rolling the resume predicate the runner encapsulates).

**Consequences:** the resume "done" predicate is owned by the runner (success-only, mirroring `swebench-batch.ts:129`); consumers cannot mark a failed row "done".

### D2 — Provision + verify-gate ride `SandboxBackend.execute`, never a direct `child_process` import

**Decision:** `provisionRepo` and `Scorers.verifyGate` issue git/test commands exclusively via `SandboxBackend.execute` (`packages/sdk/src/sandbox/types.ts:53`).

**Rationale:** `rules/architecture.md` § 2 (DIP) — same code runs on Local/Docker/E2B (`sandbox/types.ts:4-6`). theocode's direct `execFile` (`swebench-provision.ts:7`) is the non-portable shortcut we improve on. Rule 9: reuse the shipped sandbox.

**Alternatives considered:** copy theocode's promisified `execFile` into the eval layer (rejected — non-portable, duplicates `LocalSandbox`, violates DIP).

**Consequences:** `provisionRepo` takes a `sandbox` arg; tests use `LocalSandbox` against a real temp git repo.

### D3 — `loadJsonl` is generic; the SWE-bench schema is the consumer's `map`

**Decision:** `loadJsonl(path,{map?})` does only split/trim/skip-blank/parse + `line N` typed error; the SWE-bench `normalize` becomes the consumer-supplied `map`.

**Rationale:** DRY/SRP — the SDK owns the generic parse; the dataset schema is domain-specific (gap audit Seção 3.7: "Schema SWE-bench fica no app via map"). `rules/no-stubs-no-mocks-no-wired.md`: a generic loader ships fully reusable.

**Alternatives considered:** ship a SWE-bench-typed `loadSwebenchInstances` (rejected — couples the harness to one benchmark).

**Consequences:** tiny broadly-reusable loader; SWE-bench consumers pass `normalize` as `map`.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `appendJsonl` per-line flush relies on single-process serialization; concurrent OS processes writing the same file could interleave | Medium | Document single-process contract (mirror `swebench-batch.ts:196`); `Eval.run` is one process; add a concurrency test asserting interleave-safety within the process | SDK |
| `provisionRepo`/`verifyGate` shell out to `git`/test commands via the sandbox — a malicious `repoUrl`/`command` could be an injection vector | Medium | Pass git args as an argv array through `execute` (no shell string concatenation of untrusted input); document that `command` is caller-controlled trusted input | SDK |
| Verify-gate exit-code scoring assumes the test command's exit code is meaningful (0=pass) — some runners exit 0 on no-tests | Low | `verifyGate` scores 0 when stdout shows zero tests collected OR exitCode≠0; document the contract | SDK |
| Resume "done" = non-empty result could skip a row a re-run would improve | Low | Mirror theocode's deliberate choice (`swebench-batch.ts:110`): empty/failed rows ARE retried; only successful non-empty results are skipped | SDK |

## Unresolved Questions

- Q1 — Should `verifyGate` parse test output to count FAIL_TO_PASS individually, or only gate on overall exit code? (Plan resolves: exit-code first per `knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md "Recommendations" M6-2`; per-test parsing deferred to a follow-up, documented in D-less note.)
- Q2 — Does `provisionRepo` need a shallow-clone option for large repos? (Plan resolves: start with full clone like theocode `swebench-provision.ts:41`; add `depth?` only on demand — YAGNI.)
- Q3 — (none further — every other decision is resolved at plan time via D1-D3.)

## Dependency Graph

```
Phase 1 (M6-5 loadJsonl) ──▶ Phase 2 (M6-1 durable batch)
                                   │
Phase 3 (M6-3 provisionRepo) ──────┤   (Phase 3 independent of 1/2 — parallelizable)
                                   ▼
Phase 4 (M6-4 code-runner artifact) ──▶ Phase 5 (M6-2 verifyGate) ──▶ Phase 6 (Integration Validation)
```

Phase 1 blocks Phase 2 (batch persist reuses jsonl primitives). Phase 3 is independent (sandbox-only). Phase 4 feeds Phase 5 (verify-gate grades the artifact). Phase 6 is the final gate.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `node:fs` / `node:path` | builtin | node | JSONL file I/O in `internal/persistence` (mirror `swebench-dataset.ts:8`) |
| (internal) `mapWithConcurrency` | n/a | n/a | bounded concurrency in the batch runner (`packages/sdk/src/concurrency.ts:17`) |
| (internal) `SandboxBackend.execute` | n/a | n/a | git/test execution for provision + verify-gate (`sandbox/types.ts:53`) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | M6 adds ZERO new runtime dependencies — the harness uses only node builtins + existing SDK internals (`knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md "Coverage Corner 2 — Dependencies"`) | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Phase 1: M6-5 — `loadJsonl` generic dataset loader

**Objective:** Ship a generic JSONL loader with per-line typed errors; schema delegated via `map`.

### T1.1 — `loadJsonl(path, {map?})` in `internal/persistence/jsonl.ts`

#### Objective
A pure JSONL reader: split/trim/skip-blank/parse, `JsonlParseError` naming the offending line, optional `map` for typed rows.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — create `internal/persistence/jsonl.ts` with `loadJsonl<T>(path, {map?})` + `JsonlParseError`, re-export `loadJsonl` from `@theokit/sdk/eval`.
2. **Why now** — it is the dependency-free foundation (`## Dependency Graph`) that Phase 2's batch persist builds on; D3 mandates the generic-loader-with-`map` shape, mirroring `swebench-dataset.ts:82`.

#### Evidence
`knowledge-base/references/theocode-eval/lib/swebench-dataset.ts:82` (`parseJsonl` split/trim/skip-blank), `:95`/`:107` (`line N` typed `DatasetError`). `knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md "Coverage Corner 4 — Techniques"` (JSONL parse bullet).

#### Files to edit
```
packages/sdk/src/internal/persistence/jsonl.ts — NEW: loadJsonl + JsonlParseError
packages/sdk/src/internal/persistence/jsonl.test.ts — RED tests first
packages/sdk/src/eval.ts — re-export loadJsonl from @theokit/sdk/eval
```

#### Deep file dependency analysis
- `jsonl.ts` (NEW) — owns the parse; depends only on `node:fs`. Downstream: Phase 2 `appendJsonl`/`readJsonlIds` live in the same file.
- `eval.ts` (Baseline row, 86 LoC) — adds one `export { loadJsonl }`; the `Eval` class is untouched (invariant: `Eval.create/run` unchanged).

#### Deep Dives
- Signature: `loadJsonl<T = Record<string, unknown>>(path: string, opts?: { map?: (raw: Record<string, unknown>, lineNumber: number) => T }): T[]`.
- Algorithm: read utf8 → split `\n` → trim → drop blank → for each, `JSON.parse`; non-object → `JsonlParseError("line N: not a JSON object")`; parse throw → `JsonlParseError("line N: invalid JSON")`; apply `map` if given.
- Edge cases: empty file → `[]`; trailing newline → skipped; non-object line → typed error with 1-based line number.

#### Pseudo-code / Signatures
```pseudocode
function loadJsonl(path, {map}):
  text = readFileSync(path, "utf8")
  out = []
  lineNo = 0
  for rawLine in text.split("\n"):
    lineNo += 1
    line = rawLine.trim()
    if line == "": continue
    try: parsed = JSON.parse(line)
    catch: throw JsonlParseError(`line ${lineNo}: invalid JSON`)
    if typeof parsed != object or parsed == null: throw JsonlParseError(`line ${lineNo}: not a JSON object`)
    out.push(map ? map(parsed, lineNo) : parsed)
  return out

# Example
input file: '{"a":1}\n\n{"a":2}\n'
loadJsonl(path) -> [{a:1},{a:2}]
loadJsonl("bad: {x")  (line 1 "{bad")  -> throws JsonlParseError "line 1: invalid JSON"
```

#### Tasks
1. Write RED tests in `jsonl.test.ts`.
2. Implement `JsonlParseError` (extends `Error`, `name="JsonlParseError"`, `line` field) + `loadJsonl`.
3. Re-export `loadJsonl` from `eval.ts`.

#### TDD
```
RED: loadJsonl_parses_objects_and_skips_blank_lines() — asserts [{a:1},{a:2}] from '{"a":1}\n\n{"a":2}\n'
RED: loadJsonl_throws_line_numbered_error_on_invalid_json() — asserts JsonlParseError with line === 1 on a malformed line
RED: loadJsonl_throws_on_non_object_line() — asserts "line N: not a JSON object" for a bare number line
RED: loadJsonl_applies_map_for_typed_rows() — asserts map(raw,lineNo) is applied
GREEN: Implement jsonl.ts
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk test -- jsonl
```

#### Acceptance Criteria
- [ ] All four RED tests pass.
- [ ] `JsonlParseError.line` is the 1-based offending line.
- [ ] `loadJsonl` importable from `@theokit/sdk/eval`.
- [ ] Pass: lint — `pnpm --filter @theokit/sdk lint` zero warnings on changed files.
- [ ] Pass: size — `jsonl.ts` ≤ 500 lines.

#### DoD
- [ ] Tasks complete; `pnpm --filter @theokit/sdk test -- jsonl` green.
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck`.
- [ ] CHANGELOG `[Unreleased]` updated.

## Phase 2: M6-1 — Durable batch (appendJsonl/readJsonlIds + `Eval.run({persist})`)

**Objective:** Crash-durable, resumable eval runs with per-row flush + `classify`.

### T2.1 — `appendJsonl`/`readJsonlIds` + persist/resume/classify in the runner

#### Objective
Add per-row flush + resume to `runEval`, exposed via `Eval.run({persist:{path,key,resume}, classify?})`.

#### Why this step (action + reasoning)
1. **What this step does** — add `appendJsonl(path,record)` + `readJsonlIds(path,keyFn)` to `jsonl.ts`; thread `persist`/`classify` through `EvalRunOptions` → `runEval` so each completed row is appended the instant it finishes and a `resume` run skips already-keyed rows.
2. **Why now** — durability is the HIGH-severity M6-1 gap; it depends on Phase 1's `jsonl.ts` (`## Dependency Graph`). D1 mandates the runner owns resume; mirror `swebench-batch.ts:205` (flush) + `:113` (resume).

#### Evidence
`knowledge-base/references/theocode-eval/lib/swebench-batch.ts:205` (per-line `appendFileSync`), `:113`/`:129` (success-only `readDoneIds`), `:186-213` (resume+flush in the loop), `:68` (`BatchOutcome` → `classify`). Existing runner: `packages/sdk/src/internal/eval/runner.ts:339` (loop to extend). `knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md "Recommendations" M6-1`.

#### Files to edit
```
packages/sdk/src/internal/persistence/jsonl.ts — add appendJsonl + readJsonlIds
packages/sdk/src/internal/persistence/jsonl.test.ts — RED tests for append/resume
packages/sdk/src/types/eval.ts — EvalRunOptions.persist?:{path,key,resume?}; EvalRunOptions/EvalRowResult classify? (additive)
packages/sdk/src/internal/eval/runner.ts — flush per row + resume skip + classify
packages/sdk/src/eval.ts — pass-through (no signature change; run already takes EvalRunOptions)
```

#### Deep file dependency analysis
- `jsonl.ts` — adds two pure fs functions next to `loadJsonl`.
- `types/eval.ts` (148 LoC) — `EvalRunOptions` gains optional `persist` + `classify`; `EvalRowResult` gains optional `outcome?: string` (classify output). Invariant: additive-only (Baseline: existing fields stay).
- `runner.ts` (339 LoC) — inside the existing concurrency loop (per-row error isolation preserved), after a row completes: `classify` then `appendJsonl` (interleave-safe); before the loop: `readJsonlIds` to compute skip-set when `resume`. Invariant: row-error isolation + single-flight guard untouched.

#### Deep Dives
- `appendJsonl(path, record)`: `mkdirSync(dirname,{recursive})` then `appendFileSync(path, JSON.stringify(record)+"\n")` (mirror `swebench-batch.ts:192,205`); a write throw is caught + logged, never aborts the batch (`:206`).
- `readJsonlIds(path, keyFn)`: read, tolerate trailing partial line, return `Set` of keys for which `keyFn(parsed)` is truthy (success-only — mirror `:129`).
- Invariant to preserve: `runEval`'s per-row error isolation (a scorer throw becomes an error row, not a batch abort).
- Edge cases: no file → empty skip-set; `persist` absent → behavior identical to today (additive).

#### Pseudo-code / Signatures
```pseudocode
# EvalRunOptions (additive)
persist?: { path: string; key: (row: EvalRowResult) => string; resume?: boolean }
classify?: (row: EvalRowResult) => string

# in runEval, before the loop:
doneKeys = persist?.resume ? readJsonlIds(persist.path, parsed => isDone(parsed)) : empty
# per row, after scoring:
row.outcome = classify?.(row)
if persist and shouldPersist(row): appendJsonl(persist.path, toRecord(row))
```

#### Tasks
1. RED tests: append roundtrip, resume skip-set, classify sets outcome, persist-absent == today.
2. Implement `appendJsonl`/`readJsonlIds`.
3. Extend `EvalRunOptions`/`EvalRowResult` types (additive).
4. Wire persist/resume/classify into `runEval`.

#### TDD
```
RED: appendJsonl_appends_one_line_per_record_and_creates_dir() — asserts 2 records → 2 lines, parent dir created
RED: readJsonlIds_returns_only_keys_passing_predicate() — asserts failed/empty rows excluded; tolerates trailing partial line
RED: evalRun_resume_skips_already_persisted_rows() — asserts a second run with resume:true does not re-run a persisted id
RED: evalRun_flushes_each_row_the_instant_it_completes() — asserts the file has row N before row N+1 starts (per-row flush)
RED: evalRun_without_persist_behaves_identically() — asserts no file written, rows identical to baseline
GREEN: Implement appendJsonl/readJsonlIds + runner wiring
REFACTOR: extract toRecord/isDone helpers if runner exceeds clarity budget
VERIFY: pnpm --filter @theokit/sdk test -- eval
```

#### Acceptance Criteria
- [ ] All five RED tests pass.
- [ ] `persist` absent → byte-identical behavior to today (backward compat).
- [ ] Resume skips only successful rows (failed retried).
- [ ] Pass: coverage — ≥ 90% on changed files (runner persist branch: 100%).
- [ ] Pass: lint zero warnings; size ≤ 500 lines per file.

#### DoD
- [ ] `pnpm --filter @theokit/sdk test -- eval` green; typecheck clean; CHANGELOG updated.

## Phase 3: M6-3 — `provisionRepo` over `SandboxBackend.execute`

**Objective:** Portable repo provisioning (clone+checkout) with typed isolation error.

### T3.1 — `provisionRepo(sandbox,{repoUrl,ref,instanceId})` + `RepoProvisionError`

#### Objective
Clone a repo into an isolated dir and checkout a ref via the sandbox; throw `RepoProvisionError` on git failure.

#### Why this step (action + reasoning)
1. **What this step does** — create `sandbox/provision.ts` with `provisionRepo` (issues `git clone`/`checkout` via `SandboxBackend.execute`) + `RepoProvisionError`; export from `sandbox/index.ts`.
2. **Why now** — independent of Phases 1/2 (`## Dependency Graph`); D2 mandates riding `SandboxBackend.execute`; mirror `swebench-provision.ts:37` but portable.

#### Evidence
`knowledge-base/references/theocode-eval/lib/swebench-provision.ts:37` (`prepareRepo` clone+checkout), `:13` (`ProvisionError` with instanceId+cause), `:41,45` (git argv). `packages/sdk/src/sandbox/types.ts:53` (`execute`). `knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md "Recommendations" M6-3`.

#### Files to edit
```
packages/sdk/src/sandbox/provision.ts — NEW: provisionRepo + RepoProvisionError
packages/sdk/src/sandbox/provision.test.ts — RED tests (real temp git via LocalSandbox)
packages/sdk/src/sandbox/index.ts — export provisionRepo + RepoProvisionError
```

#### Deep file dependency analysis
- `provision.ts` (NEW) — depends on `SandboxBackend` (abstraction) + `RepoProvisionError` extends `TheokitAgentError` (error base, Baseline: error hierarchy backward-compatible).
- `sandbox/index.ts` (8 LoC) — adds two exports; existing `LocalSandbox`/`SandboxBackend` exports unchanged.

#### Deep Dives
- Signature: `provisionRepo(sandbox: SandboxBackend, opts: { repoUrl: string; ref: string; instanceId: string }): Promise<{ repoDir: string }>`.
- Algorithm: `repoDir = join(workDir, instanceId)`; `execute(["git","clone","--quiet",repoUrl,repoDir])` → on non-zero exit, `RepoProvisionError(instanceId, "clone failed", …)`; `execute(["git","-C",repoDir,"checkout","--quiet",ref])` → on non-zero, `RepoProvisionError(instanceId,"checkout failed")`.
- Security invariant (Drawbacks): git args passed as argv array, never a shell-concatenated string of `repoUrl`.
- Edge cases: clone of nonexistent repo → typed error; bad ref → typed error; both name the instanceId.

#### Pseudo-code / Signatures
```pseudocode
class RepoProvisionError extends TheokitAgentError { instanceId; cause }
async function provisionRepo(sandbox, {repoUrl, ref, instanceId}):
  repoDir = join(sandbox.workDir, instanceId)
  r1 = await sandbox.execute(`git clone --quiet ${shellQuote(repoUrl)} ${shellQuote(repoDir)}`)
  if r1.exitCode != 0: throw RepoProvisionError(instanceId, `clone failed: ${r1.stderr}`)
  r2 = await sandbox.execute(`git -C ${shellQuote(repoDir)} checkout --quiet ${shellQuote(ref)}`)
  if r2.exitCode != 0: throw RepoProvisionError(instanceId, `checkout ${ref} failed: ${r2.stderr}`)
  return { repoDir }

# Example
provisionRepo(local, {repoUrl: tmpBareRepo, ref: "HEAD", instanceId: "x"}) -> { repoDir: "<work>/x" }
provisionRepo(local, {repoUrl: tmpBareRepo, ref: "deadbeef", instanceId: "x"}) -> throws RepoProvisionError
```

(Note: `SandboxBackend.execute` takes a command string; args are shell-quoted to prevent injection per Drawbacks. If the backend offers an argv form, prefer it.)

#### Tasks
1. RED tests against a real temp git repo via `LocalSandbox`.
2. Implement `RepoProvisionError` + `provisionRepo`.
3. Export from `sandbox/index.ts`.

#### TDD
```
RED: provisionRepo_clones_and_checks_out_ref() — asserts repoDir exists at the requested ref (real temp git)
RED: provisionRepo_throws_RepoProvisionError_on_bad_ref() — asserts typed error naming instanceId on a nonexistent ref
RED: provisionRepo_throws_on_clone_failure() — asserts typed error on a nonexistent repoUrl
GREEN: Implement provision.ts
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk test -- provision
```

#### Acceptance Criteria
- [ ] All three RED tests pass against a real `LocalSandbox` + temp git repo (no fs/git mocks).
- [ ] `RepoProvisionError` carries `instanceId` + `cause`.
- [ ] git args are injection-safe (argv/quoted).
- [ ] Pass: lint/size/coverage gates.

#### DoD
- [ ] `pnpm --filter @theokit/sdk test -- provision` green; typecheck clean; CHANGELOG updated.

## Phase 4: M6-4 — Code-runner artifact (git diff + reverse apply-check)

**Objective:** Capture the patch as a gradeable `EvalRowResult.artifact`.

### T4.1 — code-runner: capture `git diff` + reverse `git apply --check`

#### Objective
After an agent run, capture the working-tree `git diff` and validate it applies; surface `{diff, applies}` on `EvalRowResult.artifact`.

#### Why this step (action + reasoning)
1. **What this step does** — create `internal/eval/code-runner.ts` with `captureArtifact(sandbox, repoDir)` returning `{ diff, applies }` (diff via `git diff`, applies via reverse `git apply --check`); add optional `artifact` to `EvalRowResult`.
2. **Why now** — it produces the input the Phase 5 verify-gate grades (`## Dependency Graph`); mirror `swebench-batch.ts:154,157` (buildPrediction from captured diff + reverse apply-check).

#### Evidence
`knowledge-base/references/theocode-eval/lib/swebench-batch.ts:154` (build from `result.diff`), `:157` (`diffApplies(..., {reverse:true})` no re-clone), `swebench-adapter.ts:48` (`buildPrediction`). `packages/sdk/src/types/eval.ts:91` (`EvalRowResult`). `knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md "Recommendations" M6-4`.

#### Files to edit
```
packages/sdk/src/internal/eval/code-runner.ts — NEW: captureArtifact
packages/sdk/src/internal/eval/code-runner.test.ts — RED tests (real temp git)
packages/sdk/src/types/eval.ts — EvalRowResult.artifact?: { diff: string; applies: boolean } (additive)
```

#### Deep file dependency analysis
- `code-runner.ts` (NEW) — depends on `SandboxBackend.execute` (D2). Downstream: Phase 5 verify-gate consumes `artifact`.
- `types/eval.ts` — `EvalRowResult` gains optional `artifact` (additive; Baseline invariant preserved).

#### Deep Dives
- Signature: `captureArtifact(sandbox: SandboxBackend, repoDir: string): Promise<{ diff: string; applies: boolean }>`.
- Algorithm: `diff = execute("git -C <repoDir> diff").stdout`; `applies = diff.length===0 ? false : execute("git -C <repoDir> apply --check --reverse <tmpPatch>").exitCode===0` (reverse-check on the mutated tree, mirror `swebench-batch.ts:155-157`).
- Edge cases: empty diff → `{diff:"", applies:false}`; malformed diff → `applies:false`.

#### Pseudo-code / Signatures
```pseudocode
async function captureArtifact(sandbox, repoDir):
  diff = (await sandbox.execute(`git -C ${q(repoDir)} diff`)).stdout
  if diff.length == 0: return { diff: "", applies: false }
  write diff to <repoDir>/.theo-artifact.patch via sandbox.uploadFile
  check = await sandbox.execute(`git -C ${q(repoDir)} apply --check --reverse .theo-artifact.patch`)
  return { diff, applies: check.exitCode == 0 }
```

#### Tasks
1. RED tests against a real temp git repo with a known edit.
2. Implement `captureArtifact`.
3. Add `artifact` to `EvalRowResult` type.

#### TDD
```
RED: captureArtifact_returns_diff_and_applies_true_for_real_edit() — asserts non-empty diff + applies===true
RED: captureArtifact_returns_empty_and_applies_false_for_no_edit() — asserts {diff:"",applies:false}
GREEN: Implement code-runner.ts
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk test -- code-runner
```

#### Acceptance Criteria
- [ ] Both RED tests pass against real temp git (no mocks).
- [ ] `EvalRowResult.artifact` is optional (additive).
- [ ] Pass: lint/size/coverage gates.

#### DoD
- [ ] `pnpm --filter @theokit/sdk test -- code-runner` green; typecheck clean; CHANGELOG updated.

## Phase 5: M6-2 — `Scorers.verifyGate` (exit-code scoring)

**Objective:** Grade a patch by running tests and reading the exit code.

### T5.1 — `Scorers.verifyGate({failToPass,passToPass})`

#### Objective
A scorer that runs the project's test command via the sandbox and scores 1 on exit 0, else 0.

#### Why this step (action + reasoning)
1. **What this step does** — add `verifyGate` to the `Scorers` object: given `{failToPass,passToPass}` + a `command` builder, run via `SandboxBackend.execute` and score `exitCode===0 ? 1 : 0`.
2. **Why now** — it grades the Phase 4 artifact (`## Dependency Graph`); D2 mandates riding `execute`; mirror the prediction→score split (`swebench-batch.ts:16`).

#### Evidence
`packages/sdk/src/scorers.ts:56` (`Scorers` object to extend), `packages/sdk/src/sandbox/types.ts:14` (`ExecuteResult.exitCode`). `knowledge-base/references/theocode-eval/lib/swebench-batch.ts:16` (scoring deferred to exit-code harness). `knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md "Recommendations" M6-2`.

#### Files to edit
```
packages/sdk/src/scorers.ts — add verifyGate to the Scorers object
packages/sdk/src/scorers.test.ts — RED tests (LocalSandbox + a script exiting 0/1)
packages/sdk/src/types/eval.ts — verifyGate option type (additive)
```

#### Deep file dependency analysis
- `scorers.ts` (151 LoC) — `verifyGate` is a new key on the existing `Scorers` object; existing scorers unchanged (Baseline invariant).
- Depends on `SandboxBackend.execute` (D2) + reads `ExecuteResult.exitCode`.

#### Deep Dives
- Signature: `verifyGate(opts: { sandbox: SandboxBackend; repoDir: string; failToPass: string[]; passToPass: string[]; command?: (tests: string[]) => string }): NamedScorer`.
- Algorithm: build the test command (default: `<runner> <failToPass+passToPass>`); `execute(command)`; `score = exitCode===0 ? 1 : 0`; `reason` includes exitCode + truncated stderr.
- Edge cases: zero tests collected → score 0 (Drawbacks Q-low); non-zero exit → 0 with stderr in reason.

#### Pseudo-code / Signatures
```pseudocode
verifyGate({sandbox, repoDir, failToPass, passToPass, command}): NamedScorer
  return { name: "verify-gate", score: async () => {
    cmd = command ? command([...failToPass, ...passToPass]) : defaultCmd(...)
    r = await sandbox.execute(`cd ${q(repoDir)} && ${cmd}`)
    pass = r.exitCode === 0
    return { score: pass ? 1 : 0, reason: `exit=${r.exitCode} ${r.stderr.slice(0,200)}` }
  }}
```

#### Tasks
1. RED tests with a `LocalSandbox` running a script that exits 0 then 1.
2. Implement `verifyGate`.
3. Add option type to `types/eval.ts`.

#### TDD
```
RED: verifyGate_scores_1_when_test_command_exits_zero() — asserts score 1
RED: verifyGate_scores_0_when_test_command_exits_nonzero() — asserts score 0 + exit code in reason
GREEN: Implement verifyGate
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk test -- scorers
```

#### Acceptance Criteria
- [ ] Both RED tests pass against a real `LocalSandbox`.
- [ ] `Scorers.verifyGate` returns a valid `NamedScorer`; existing scorers unchanged.
- [ ] Pass: lint/size/coverage gates.

#### DoD
- [ ] `pnpm --filter @theokit/sdk test -- scorers` green; typecheck clean; CHANGELOG updated.

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | M6-5 `loadJsonl` generic loader | T1.1 | `loadJsonl(path,{map})` + `JsonlParseError` (line N) |
| 2 | M6-1 durable batch (resume + flush + classify) | T2.1 | `appendJsonl`/`readJsonlIds` + `Eval.run({persist,classify})` |
| 3 | M6-3 `provisionRepo` | T3.1 | `provisionRepo(sandbox,…)` + `RepoProvisionError` over `execute` |
| 4 | M6-4 code-runner artifact | T4.1 | `captureArtifact` → `EvalRowResult.artifact{diff,applies}` |
| 5 | M6-2 verify-gate scorer | T5.1 | `Scorers.verifyGate({failToPass,passToPass})` by exit code |

**Coverage: 5/5 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk test` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk lint`
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Backward compatibility preserved across public API (all new fields/options additive; existing `Eval`/`Scorers`/`SandboxBackend` signatures unchanged)
- [ ] Plan-specific: M6-1..M6-5 each shipped wired (no stubs per `rules/no-stubs-no-mocks-no-wired.md`), zero new runtime deps
- [ ] Runtime-metric proof — the durable-batch persist path is observed writing real lines + resuming in the integration test (`m6-eval-harness.test.ts`), not just compiling
- [ ] Plan archived — after `/review` READY_TO_MERGE AND PR merged, move to `knowledge-base/plans/completed/`

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the M6 chain end-to-end on a real workload (real temp git + real LocalSandbox + real JSONL file).

### Execution

```
pnpm --filter @theokit/sdk test          # unit + integration (incl. m6-eval-harness.test.ts)
pnpm --filter @theokit/sdk typecheck     # zero type errors
pnpm --filter @theokit/sdk lint          # zero lint warnings
```

The integration test `packages/sdk/tests/eval/m6-eval-harness.test.ts` wires the full chain: write a JSONL dataset → `loadJsonl` → `provisionRepo` a real temp git repo → run a scripted agent → `captureArtifact` → `Eval.run({persist})` → assert resume skips on a second run → `verifyGate` grades a known-passing/failing patch.

### Acceptance Criteria

- [ ] All test suites green (unit + integration)
- [ ] Coverage ≥ 90% on changed files (persist/resume + provision + verify-gate branches: 100%)
- [ ] Zero type errors
- [ ] Zero lint warnings
- [ ] Runtime-metric proof — the integration test asserts the persisted JSONL file actually grows per row and a resume run skips persisted ids (durability observed, not assumed)

### If Validation Fails

1. Separate plan-caused failures from pre-existing.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description; they do not block.
