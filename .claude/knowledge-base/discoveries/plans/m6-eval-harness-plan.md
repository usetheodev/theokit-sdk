# Discovery Plan: M6 — Eval Harness (Tema E)

> **Version 1.0** — Investigate how theocode hand-rolled a SWE-bench-style eval harness (`server/lib/swebench-{batch,provision,dataset,adapter}.ts` + `eval-suite.ts`, mirrored read-only under `knowledge-base/references/theocode-eval/`) so we can promote that plumbing to first-party `@theokit/sdk` eval + sandbox primitives. Output blueprint decides the exact public API + reuse points over the existing `Eval`/`Scorers`/`SandboxBackend` surface for the five M6 gaps (M6-1..M6-5, gap audit Seção 3.7).

**Slug:** `m6-eval-harness`
**Owner:** claude
**Created:** 2026-06-22
**Time budget:** 3h (single reference project — breakdown in ADR D1)

## Context

The gap audit (`docs/gap-audit/THEOKIT_GAP_AUDIT.md` Seção 3.7) flags five HIGH/MED/LOW eval-harness gaps: the SDK already ships an eval runner (`packages/sdk/src/eval.ts` → `Eval.create/run`, `Scorers`), a `SandboxBackend`/`LocalSandbox` with `ExecuteResult.exitCode` (`packages/sdk/src/sandbox/`), and `git diff` capture — but lacks the glue that turns "agent edited a repo" into "here is the patch and it applies/passes": verify-gate-by-exit-code scoring, `loadJsonl`, `provisionRepo`, and a crash-durable batch runner (resume + per-line flush). theocode hand-rolled all of it (the prior-art now mirrored under `knowledge-base/references/theocode-eval/`); a serious consumer would rebuild the same crash-durability because SWE-bench runs are multi-hour and $-heavy. This discovery extracts the proven shapes before we lock the SDK API. Respects `rules/architecture.md` § 3 (module cohesion: eval-internals stay `@internal`, public surface minimal) and `rules/no-stubs-no-mocks-no-wired.md` (every promoted primitive must ship wired, not as a catalog stub).

## Objective

Decide the exact first-party `@theokit/sdk` eval + sandbox API (and internal reuse points) for the five M6 primitives, grounded in theocode's proven hand-roll. Measurable success criteria:

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/theocode-eval/`
- [ ] Cross-cutting comparison table populated (theocode hand-roll → proposed SDK primitive → existing SDK surface to reuse) for every in-scope question
- [ ] Recommendations section provides at least one concrete API proposal per M6 item (M6-1..M6-5)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/theocode-eval/` | `lib/swebench-batch.ts`, `lib/swebench-provision.ts`, `lib/swebench-dataset.ts`, `lib/swebench-adapter.ts`, `lib/eval-suite.ts`, `tests/` | The exact hand-rolled harness being promoted; proven against real SWE-bench runs |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| theocode anything outside the mirrored `swebench-*` + `eval-suite` files | Domain-specific code-assistant wiring, not generic harness plumbing |
| The official SWE-bench Docker 3-layer images | Rule 9 — theocode deliberately uses plain `git clone`+`checkout` (provision) and defers Docker scoring to the official harness; the SDK promotes the portable path, not a Docker reimplementation |
| `packages/sdk/dist/**`, build artifacts | Generated output |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** Single reference project (`theocode-eval`): 3h. No split needed — one prior-art source.

**Rationale:** All five M6 items derive from one cohesive hand-roll (4 lib files + tests). The design is already specified in gap audit Seção 3.7; this discovery validates the shapes against the actual code, not from scratch.

**Alternatives considered:** clone the official SWE-bench repo as a second reference (rejected — Rule 9: theocode already chose the portable non-Docker path; adding Docker prior-art expands scope without changing the SDK API decision).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 query-variant retries, mark the question BLOCKED with reason "Fase A exhausted" and continue. Never fabricate Fase B answers (Unbreakable Rule 3).

**Stop condition — per project (mandatory):** When the 3h budget is exhausted with questions pending, mark remaining questions BLOCKED with reason "budget exhausted"; if every question is `done` or honestly `blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>` with the honest report. Never emit `BLUEPRINT_COMPLETE` from a blocked state.

**Consequences:** the halt-loop stops when budget exhausts; blocked questions surface in `## Blocked questions`.

### D2 — Investigation depth

**Decision:** Read each in-scope lib file end-to-end (they are small, 50-220 LoC) + read the test files for the boundary patterns. Map symbols with grep first, then Read at each hotspot.

**Rationale:** The files are small and dense; full reads capture the edge-case handling (resume-retries-failed-rows, per-line flush ordering, provision error isolation) that a grep would miss. Aligns with `rules/testing.md` § 2 (integration tests exercise real boundaries — we must read them to mirror the pattern).

**Consequences:** higher fidelity blueprint; trade-off is the 3h budget is mostly Read, not broad scan.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep/ast map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does theocode's batch runner persist each prediction incrementally and resume a crashed run (appendJsonl / readDoneIds / per-line flush / outcome taxonomy)? [M6-1] | techniques | `.claude/knowledge-base/references/theocode-eval/lib/swebench-batch.ts` | `grep -nE 'appendFileSync|readDoneIds|resume|BatchOutcome|runSwebenchBatch'` to map the resume + flush + classify hotspots | Read `readDoneIds` (success-only resume), `runSwebenchBatch` (flush-the-instant-it-completes), `BatchOutcome` taxonomy, `RunSwebenchBatchOpts` | Table: hand-roll symbol → SDK primitive (`appendJsonl`/`readJsonlIds` in `internal/persistence`, `Eval.run({persist:{path,key,resume}})`, `classify`) → existing SDK reuse, with `references/.../path:line` per row |
| Q2 | How does theocode provision an isolated repo and build the gradeable patch artifact + verify-gate input (clone/checkout + ProvisionError; buildPrediction from captured git diff; exit-code scoring)? [M6-2, M6-3, M6-4] | techniques | `.claude/knowledge-base/references/theocode-eval/lib/swebench-provision.ts`, `.claude/knowledge-base/references/theocode-eval/lib/swebench-adapter.ts` | `grep -nE 'prepareRepo|ProvisionError|git clone|checkout|buildPrediction|toPrediction|model_patch'` across both files | Read `prepareRepo` (git clone+checkout, per-instance isolation), `ProvisionError`, `buildPrediction`/`toPrediction` (diff → prediction record) | Three-part answer: provision API (`provisionRepo(sandbox,{repoUrl,ref,instanceId})` + `RepoProvisionError`), verify-gate scorer (`Scorers.verifyGate` via `SandboxBackend.execute` exit code), and `EvalRowResult.artifact{diff,applies}`, each with citations |
| Q3 | How does theocode parse a JSONL dataset with per-line typed errors and normalize rows? [M6-5] | techniques | `.claude/knowledge-base/references/theocode-eval/lib/swebench-dataset.ts` | `grep -nE 'parseJsonl|DatasetError|line \$\{|JSON.parse|split'` to map the parse + per-line-error hotspots | Read `parseJsonl` (split/trim/skip-blank, `line N` typed error) + `normalize`/`requireString` | Proposed generic `loadJsonl(path,{map?})` signature with `line N`-typed error, schema delegated to the app via `map`, citations to the hand-roll |
| Q4 | How does theocode integration-test the batch/provision/dataset boundaries against the real filesystem + git? | tests | `.claude/knowledge-base/references/theocode-eval/tests/swebench-batch.test.ts`, `.claude/knowledge-base/references/theocode-eval/tests/swebench-provision.test.ts`, `.claude/knowledge-base/references/theocode-eval/tests/swebench-dataset.test.ts` | `grep -nE 'describe|it\(|tmp|mkdtemp|git init|appendFileSync|expect'` across the three test files | Read each test's setup (tmp dir / real git repo) + the assertions on resume/flush/provision-error/line-error | Table: boundary → test technique (tmpdir + real git, resume roundtrip, malformed-line assertion) → which SDK test we mirror, per `rules/testing.md` § 2 |
| Q5 | What runtime dependencies does the harness pull in, and what does the existing SDK sandbox already provide so the SDK promotion adds zero new deps? | deps | `.claude/knowledge-base/references/theocode-eval/lib/swebench-batch.ts`, `.claude/knowledge-base/references/theocode-eval/lib/swebench-provision.ts` | `grep -nE "^import|from 'node:|exec\(|child_process"` across the lib files | Read the import headers + the `exec` usage; cross-check against `packages/sdk/src/sandbox/types.ts` `ExecuteResult` already shipping `exitCode` | Dependency list (node:fs, node:child_process only) + the reuse mapping (provision/verify-gate ride `SandboxBackend.execute`), citations |
| Q6 | What is the harness's run/reproduce story (how a batch is invoked end-to-end, the official-Docker-harness boundary, env/network assumptions)? | tools | `.claude/knowledge-base/references/theocode-eval/tests/swebench-repro.test.ts`, `.claude/knowledge-base/references/theocode-eval/lib/swebench-dataset.ts` | SKIP heavy Fase A — read the repro test + the file header comments | Read `swebench-repro.test.ts` end-to-end + the `swebench-dataset.ts` header (no-network, caller exports HF split to JSONL) | Step-by-step run story + the no-network/Docker-boundary contract the SDK primitives must respect |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q5 | Covered |
| Tools | Q6 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | The `.claude/knowledge-base/references/theocode-eval/{path}` declared in Fase A exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | Fase A returned ≥1 hotspot OR 3 retries attempted | After 3 retries empty, mark Qx BLOCKED "Fase A exhausted" |
| After answering Qx | Blueprint section under Qx has ≥1 citation | Re-iterate Qx (1 retry max) |
| Per-project time budget | 3h not exhausted | When exhausted, mark remaining Qx BLOCKED "budget exhausted" |
| Before promising complete | All 4 coverage corners have populated blueprint sections | Refuse promise, continue iterating |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/references/theocode-eval/{...}` path
- [ ] At least one ADR section in the blueprint synthesizes the API decision per M6 item
- [ ] Time budget respected (3h)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one project rule (`architecture.md` § 3 module cohesion, `testing.md` § 2 pyramid, `no-stubs-no-mocks-no-wired.md`) or principle (KISS/YAGNI/DRY)
