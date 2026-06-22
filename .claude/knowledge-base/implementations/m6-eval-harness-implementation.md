---
slug: m6-eval-harness
milestone_id: M6
date: 2026-06-22
plan: .claude/knowledge-base/plans/m6-eval-harness-plan.md
blueprint: .claude/knowledge-base/discoveries/blueprints/m6-eval-harness-blueprint.md
status: IMPLEMENTATION_COMPLETE
---

# M6 — Eval Harness (Tema E) — Implementation Summary

Promotes theocode's hand-rolled SWE-bench harness plumbing to first-party
`@theokit/sdk` eval + sandbox primitives (M6-1..M6-5), reusing the existing
`Eval`/`Scorers`/`SandboxBackend`/`internal/persistence` surface with **zero new
runtime dependencies**.

## Tasks delivered (TDD: RED → GREEN → REFACTOR → WIRING → COMMIT)

| Task | Gap | Commit | What shipped |
|---|---|---|---|
| T1.1 | M6-5 + M6-1 primitives | `301d4a3` | `loadJsonl(path,{map?})` + `JsonlParseError(line)`; `appendJsonl`/`readJsonlIds` durable-JSONL primitives in `internal/persistence/jsonl.ts` |
| T2.1 | M6-1 durable batch | `5d6ce2a` | `Eval.run({persist:{path,key,resume?},classify?})` — per-row flush + success-only resume + `EvalRowResult.outcome` |
| T3.1 | M6-3 provision | `a4b869b` | `provisionRepo(sandbox,{repoUrl,ref,instanceId})` + `RepoProvisionError` over `SandboxBackend.execute` |
| T4.1 | M6-4 artifact | `d921c4c` | `captureArtifact(sandbox,repoDir)` git-diff + reverse apply-check → `EvalRowResult.artifact?:{diff,applies}` |
| T5.1 | M6-2 verify-gate | `453855c` | `Scorers.verifyGate({sandbox,repoDir,failToPass,passToPass,command?})` exit-code grading |
| Phase 6 | Integration | `5d9f224` | Full-chain integration test on real git + LocalSandbox |
| Wiring | M6-4 public | `26ec322` | `captureArtifact` re-exported from `@theokit/sdk/eval` |
| Gate | lint whitelist | (M6) | `internal/persistence/jsonl.ts` whitelisted in no-unredacted-sink (generic JSONL writer, caller-owned payload) |

## Wiring triad per primitive

| Primitive | (a) Caller / public surface | (b) Integration test | (c) Observability |
|---|---|---|---|
| `loadJsonl` | `@theokit/sdk/eval` re-export; used in integration | `m6-eval-harness.test.ts` (dataset load + persist roundtrip) | typed `JsonlParseError(line N)` |
| `appendJsonl`/`readJsonlIds` | `runEval` (per-row flush + resume) | `eval-persist.test.ts`, `jsonl.test.ts` | `console.warn` on append failure (never aborts batch) |
| `persist`/`classify` | `Eval.run` → `runEval` (both manual + batch paths) | `eval-persist.test.ts` (flush/resume/retry/classify/no-persist) | `EvalRowResult.outcome` persisted per row |
| `provisionRepo` | `@theokit/sdk/sandbox` re-export | `provision.test.ts` (real temp git) | `RepoProvisionError` names `instanceId` |
| `captureArtifact` | `@theokit/sdk/eval` re-export | `code-runner.test.ts` (real temp git) | `EvalRowResult.artifact?:{diff,applies}` |
| `verifyGate` | `Scorers.verifyGate` via `@theokit/sdk/eval` | `verify-gate.test.ts` + integration (0→1 flip) | `Score.reason` carries `exit=N` + stderr |

## Validation gates

- **Full suite:** `2856 passed | 0 failed | 35 skipped` (`vitest run --no-file-parallelism`).
- **Build:** `tsup` success — all subpath entries (`eval`, `sandbox`) emit ESM+CJS+dts.
- **Typecheck:** `tsc --noEmit` clean.
- **Lint:** biome clean on all changed files; cognitive complexity ≤ 10 (extracted `runManualSlot`, `tryParseObjectLine`).
- **code-quality:** verdict `PASS` (audit `m6-eval-harness-code-quality-2026-06-22.md`). Project config disables per-language detectors; supplemented with manual D1/D3 reachability — every new M6 symbol has a real caller or is intentional public-API surface (no orphan, no fabrication).
- **M6-specific tests:** 14 eval + 3 provision + 5 (incl. shared) + 3 verify-gate + 2 integration — all green.

## ADR adherence

- **D1** — durable-JSONL primitives in `internal/persistence`; durability surfaced only via `Eval.run({persist})`; `loadJsonl` re-exported (dataset-input side).
- **D2** — `provisionRepo`/`captureArtifact`/`verifyGate` ride `SandboxBackend.execute` (portable Local/Docker/E2B); never a direct `child_process`. POSIX shell-escape on every interpolated value (injection guard), extracted to shared `sandbox/shell-escape.ts`.
- **D3** — `loadJsonl` is generic; the SWE-bench schema lives in the consumer's `map`.

## Coverage Matrix: 5/5 gaps (M6-1..M6-5) — 100%

Zero new runtime dependencies. Changeset: `.changeset/m6-eval-harness.md`.
