# Review: M0 Foundation — Expose Existing Primitives

> Cycle: REVIEW (rules/cycle-review.md). Plan: `m0-foundation-expose-primitives`. Branch: `develop`. Diff range: `9784eb2..HEAD`. Date: 2026-06-19.
> Reviewers: 5 parallel specialist agents (architecture, test-auditor, behavior-preservation, cross-validation, correctness/security) + adjudication by the cycle coordinator.

## Verdict: READY_TO_MERGE

No BLOCKER findings survive adjudication. The single legitimate HIGH (withRetry input validation) was fixed in this cycle. Remaining findings are LOW/INFO or pre-existing documented tradeoffs.

## Validation gates (all green)

| Gate | Result |
|---|---|
| Full `@theokit/sdk` test suite | 2641 passed, 35 skipped, **1 pre-existing flaky** (telemetry `agent-send-parent-span`, passes in isolation — unrelated to this slice) |
| `@theokit/sdk-memory` (against fresh dist) | 5/5 passed; logs the NEW `memory-index database corrupt` message → migration genuinely consumes `openSqliteResilient` |
| typecheck (sdk + sdk-memory) | clean |
| biome | clean on all changed files |
| build (tsup + tsc DTS) | success; all subpath artifacts present |
| attw | No problems found (concurrency + retry: node10/node16 CJS+ESM/bundler green) |
| knip (`quality:dead`) | exit 0 — zero dead exports for the 5 new surfaces |
| Coverage Matrix | 5/5 (100%) |

## Adjudicated findings

### Refuted (false positives) — with evidence

| Claimed | Severity claimed | Adjudication |
|---|---|---|
| `mapWithConcurrency` leaks a semaphore permit when aborted mid-`acquire()` | BLOCKER | **Refuted.** Every `acquire()` is paired with a `finally`-`release()`, and every queued waiter is eventually granted as in-flight items release. `Promise.all` rejection does NOT cancel sibling promises (they continue and hit their `finally`). Definitive evidence: the abort test settles without timeout — impossible if a queued promise never resolved. No leak. |
| `sanitizeRunId` not migrated to `safeFilenameForId` | MEDIUM | **Refuted.** `grep` confirms `sanitizeRunId` removed; `session-summary-writer.ts` calls `safeFilenameForId(runId,{maxLen:128})`. Agent inspected a wrong path (`sdk-memory/.../store/`). Cross-validation agent independently confirmed migration complete. |
| `runBatches` inline pool not deduplicated | MEDIUM | **Refuted.** `grep` confirms the inline acquire/release pool is gone; `embedInBoundedBatches` now calls `mapWithConcurrency`. Agent inspected a wrong path. |

### Pre-existing / documented tradeoffs (not introduced by this slice)

| Finding | Severity | Disposition |
|---|---|---|
| `openSqliteResilient` rename-aside uses `.catch(()=>undefined)` (silent on rename failure) | (claimed BLOCKER) | The behavior is **byte-identical to the original `openMemoryDb`** (behavior-preserving extraction) and is explicitly documented as a known tradeoff in the plan Drawbacks table + ADR-M0-5 ("rename-aside, not backup"). Out of scope for an expose/dedup slice; tracked for a future hardening cycle if desired. |
| Orphan `.corrupt-*` file if `onOpen` fails after recovery | LOW | Pre-existing-shaped; documented behavior. |

### Fixed in this cycle

| Finding | Severity | Fix (commit) |
|---|---|---|
| `withRetry` accepts `retries: Infinity`/negative/non-integer → potential infinite loop | HIGH | Added `ConfigurationError` validation in `resolveRetryOptions` + regression test `test_withRetry_throws_on_invalid_retries`. |
| `loadDriver` gives a generic error if the `better-sqlite3` export is not a constructor | LOW | Added an explicit `typeof Ctor !== "function"` check with a precise message. |

### Accepted as-is (LOW/INFO)

| Finding | Severity | Rationale |
|---|---|---|
| `concurrency.test.ts` uses real `setTimeout` | LOW | The order-preservation test is deterministic (results indexed by input, not completion time). The concurrency/abort tests use robust `<=`/`<` assertions with generous margins. Acceptable; `retry.test.ts` is the injectable-clock exemplar. |
| `safeFilenameForId` `h-` prefix visual ambiguity | INFO | A passthrough id and a hash token colliding requires a sha256-tier collision; deterministic-per-input. Harmless for filename uniqueness. |
| `isTransientError` custom-subclass nuance | INFO | Logic reads the instance's `isRetryable`; custom subclasses work correctly. |
| `mapWithConcurrency`/`withRetry` fail-fast does not cancel in-flight work | INFO | Documented in JSDoc; matches the deduplicated clones' prior behavior. |

## Hard gates (cycle-review BLOCKER checks)

- Failing tests on branch: none introduced (1 pre-existing flaky, documented).
- New secrets committed: none.
- Direct commit to `main`: none (all on `develop`).
- `Co-Authored-By` trailer: none (repo policy honored).
- CHANGELOG updated despite source changes: yes (root `[Unreleased]` + changeset).

## Architecture & cross-validation summary

- Architecture agent: zero findings. DIP/layering respected; primitives placed in correct layers; no inner→outer dependency; dedup introduced no coupling or cycle.
- Cross-validation agent: zero divergences plan↔code; all 5 ADRs honored; wiring triad satisfied (every new export has a real caller); docs.md + CHANGELOG + changeset complete; backward-compatible (additions only).
- Behavior-preservation agent: tool-dispatch (`boundedParallel`→`mapWithConcurrency`) and both `index-db` (→`openSqliteResilient`) confirmed behavior-preserving with forensic before/after comparison (WAL→PRAGMA→SCHEMA order + corruption-recovery identical).

## Next step

`READY_TO_MERGE`. Per cycle-release, this unblocks a `develop → main` release PR for the `@theokit/sdk` minor (changeset present). Plan to be archived to `knowledge-base/plans/completed/` only after the PR merges.
