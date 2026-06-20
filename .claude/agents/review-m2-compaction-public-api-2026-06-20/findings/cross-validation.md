# Cross-Validation Findings — m2-compaction-public-api

**Verdict:** Plan and implementation match faithfully. 0 BLOCKER, 0 HIGH, 0 MEDIUM, 0 LOW, 2 INFO.

The implementation (commits `1fdfff0` Phase 1 + `5b8c9e7` T2.1) implements the plan
`.claude/knowledge-base/plans/m2-compaction-public-api-plan.md` line-by-line. Every task
(T1.1, T1.2, T2.1) is fully implemented, every Acceptance Criterion is observably satisfied,
every DoD item passes, all 6 Coverage-Matrix gaps map to delivered code, all 5 ADRs (D1-D5)
are honored, both baseline corrections hold, and the Global DoD is true against repo state.
No plan drift (plan committed `c8f031a` 18:59:07 — frozen before the first /implement commit
at 19:07:45).

---

## Task-by-task verification

### T1.1 — isContextOverflowError + checkpoint trio (commit 1fdfff0)
- Files declared (`src/compaction.ts` NEW, `tests/compaction.test.ts` NEW) — both present in diff. No scope creep.
- AC1: 10/10 isContextOverflowError|Checkpoint tests pass (verified `vitest run`). SATISFIED.
- AC2: `test_isContextOverflowError_true_on_metadata_code` present + green (D3 dual-field). SATISFIED.
- AC3: `test_filterFromLatestCheckpoint_returns_after_latest` present + green (D2 backward scan). SATISFIED.
- AC4: biome clean on `src/compaction.ts` (exit 0). SATISFIED.
- DoD: vitest green, typecheck exit 0. SATISFIED.

### T1.2 — compactTranscript reusing selectCompressionWindow (commit 1fdfff0)
- Files declared (same module + tests) — present. No scope creep.
- AC1: 19/19 (10 T1.1 + 9 T1.2) green within the 21 total. SATISFIED.
- AC2: `test_compactTranscript_summarize_prepends_summary` green (D1 delegation). SATISFIED.
- AC3: `test_compactTranscript_preserves_system` green. SATISFIED.
- AC4: `grep -c selectCompressionWindow src/compaction.ts` = 2 (import + call) ≥ 1 — reuse, not reimplement (DRY). SATISFIED.
- AC5: biome clean. SATISFIED.
- AC6: `wc -l src/compaction.ts` = 87 ≤ 120. SATISFIED.
- DoD: 19/19 green, typecheck 0, biome clean. SATISFIED.

### T2.1 — wire @theokit/sdk/compaction subpath + integration test + docs + changeset (commit 5b8c9e7)
- Files declared: package.json, tsup.config.ts, tsconfig.tools-dts.json, mirror-dts-to-cts.mjs, tests/compaction-wiring.test.ts (NEW), docs.md, packages/sdk/CHANGELOG.md, .changeset/m2-compaction-public-api.md — ALL present in diff. No scope creep (8 files, exactly the declared set).
- AC1: 2/2 wiring tests pass. SATISFIED.
- AC2: package.json exports `./compaction` defined. SATISFIED.
- AC3: `compaction` in tsup.config.ts entry (line 11) + `src/compaction.ts` in tsconfig.tools-dts.json include. SATISFIED.
- AC4: `compaction.d.ts` in mirror-dts-to-cts.mjs (line 34). SATISFIED.
- AC5: `@theokit/sdk/compaction` in docs.md (line 1875) + changeset file exists + `compactTranscript` in CHANGELOG.md (line 97). SATISFIED.
- AC6: biome clean. SATISFIED.
- DoD: wiring tests green, typecheck 0, build succeeds, `dist/compaction.d.ts` + `dist/compaction.d.cts` both exist (verified), docs+changeset+CHANGELOG present. SATISFIED.

## Coverage Matrix (6/6 delivered)
| # | Gap | Task | Delivered code |
|---|---|---|---|
| 1 | public compactTranscript | T1.2 | `compaction.ts:39` reuses `selectCompressionWindow:46` |
| 2 | checkpoint helpers | T1.1 | `CHECKPOINT_MARKER:24`, `buildCheckpoint:58`, `filterFromLatestCheckpoint:66` |
| 3 | isContextOverflowError | T1.1 | `compaction.ts:81` dual-field |
| 4 | ./compaction subpath | T2.1 | package.json exports + tsup + tsconfig.tools-dts + mirror |
| 5 | zero new deps | T1.2/D5 | runtime `dependencies` = `{croner}` on both main and HEAD (unchanged) |
| 6 | document+record+prove | T2.1 | docs.md §Compaction + changeset + CHANGELOG + wiring test |

## ADR compliance (5/5 respected)
- D1: `compactTranscript` calls `selectCompressionWindow(nonSystem, keepRecent)` (`compaction.ts:46`), optional async `summarize` callback prepends single result before preserved tail. CONFIRMED.
- D2: `CHECKPOINT_MARKER` string sentinel (`:24`) + backward-scan `filterFromLatestCheckpoint` (`:66-73`, loops `i = length-1 downto 0`). CONFIRMED.
- D3: `isContextOverflowError` reads `err.code === "context_too_long" || err.metadata?.code === "context_too_long"` (`:81-86`). CONFIRMED.
- D4: plain exported functions (`compactTranscript`, `buildCheckpoint`, `filterFromLatestCheckpoint`, `isContextOverflowError`) — no strategy-object hierarchy. CONFIRMED.
- D5: tsc-DTS path (in tsconfig.tools-dts include, NOT rollup dts.entry block) + zero new runtime deps. CONFIRMED.

## Baseline corrections (both hold)
1. compaction operates on `CompressibleMessage` — `compaction.ts:16` imports the type from `internal/runtime/compression/compression-summarizer.js` and re-exports it (`:18`); all signatures use it. CONFIRMED.
2. compaction.ts reaches internal/runtime → tsc-DTS — `src/compaction.ts` is in `tsconfig.tools-dts.json` include and is ABSENT from the rollup `dts.entry` block (tsup.config.ts:42-50, which lists only index/errors/cron/server/*). CONFIRMED.

## Global DoD (all true)
- compaction.test.ts + compaction-wiring.test.ts: 21/21 green (= plan's 21 Final-Phase target).
- typecheck exit 0; biome clean on changed files; knip clean (no compaction findings); dep-cruiser clean (416 modules, 0 violations — compaction has value edges, not orphan); build exit 0 with all 4 dist artifacts; CHANGELOG + changeset present; docs.md reflects new surface; compactTranscript reuses selectCompressionWindow (no duplicate algorithm); isContextOverflowError reads typed code (no message-regex); checkpoint round-trips.

---

## [INFO] CHECKPOINT_MARKER value differs from plan pseudo-code (cosmetic)
- file: packages/sdk/src/compaction.ts:24
- detail: Plan pseudo-code (line 170) shows `CHECKPOINT_MARKER = " theokit:checkpoint "` (single trailing space). Implementation uses `" theokit:checkpoint  "` (leading space + double trailing space). Pseudo-code is explicitly non-binding ("# unambiguous sentinel"); the exact sentinel string is an implementation detail and `buildCheckpoint` is the only sanctioned producer, so round-trip correctness is unaffected (all checkpoint tests green). The Drawbacks table (plan line 129) only required "an unambiguous sentinel", which this is.
- fix: None required. Optionally align the comment/value if a canonical literal is desired, but no behavioral impact.

## [INFO] compactTranscript system-filter does not exclude checkpoint-marker turns (plan-authorized GREEN-time decision)
- file: packages/sdk/src/compaction.ts:44
- detail: Plan pseudo-code line 232 sketched `system = messages.filter(m => m.role === "system" && !content.startsWith(CHECKPOINT_MARKER))`. The implementation filters system by role only (`m.role === "system"`), so a checkpoint turn (role "system") IS preserved as a leading system turn during compaction. This is a benign divergence: (a) the plan explicitly licensed it — line 241 states "Exact system-preservation semantics finalized at GREEN — preserve system turns in original order"; (b) no Acceptance Criterion or test constrains checkpoint-vs-compaction interaction; (c) preserving the marker is arguably more correct (a checkpoint a caller inserted is intentional context). Not a silent ADR override — it falls inside the plan's stated GREEN-time latitude.
- fix: None required. If a future caller needs compaction to strip stale checkpoint markers, that is a new requirement (out of M2-1 scope), not a defect here.
