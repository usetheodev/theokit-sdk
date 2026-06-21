# Review: m3-repo-map

**Date:** 2026-06-21
**Reviewers (spawned agents):** 3 — architecture+wiring, test-auditor, cross-validation+behavior (general-purpose, opus-class)
**Findings (initial):** 0 BLOCKER, 3 HIGH (2 on the EC-1 symlink test + 1 vacuous knip-claim in the plan DoD), 2 MEDIUM (untested branches), LOW/INFO
**Findings (after fix `ad2a68a`):** 0 BLOCKER, 0 HIGH, 0 MEDIUM (all fixed with tests/wording), advisory LOW/INFO only
**Verdict:** READY_TO_MERGE

> Per-agent finding files: `.claude/agents/review-m3-repo-map-2026-06-21/findings/*.md`.

## Scope reviewed

Commits `9561d74` (T1.1 builders) + `6ef9eae` (T2.1 export/docs) + review-fix `ad2a68a`, on `develop` vs `main`. Files: `packages/sdk-tools/src/internal/repo-map.ts`, `index.ts`, `tests/repo-map.test.ts`, `docs.md`, root `CHANGELOG.md`, `.changeset/m3-repo-map.md`.

## HIGH findings (RESOLVED in `ad2a68a`)

### [HIGH → FIXED] EC-1 symlink test was non-distinguishing
- Flagged by: test-auditor
- file: `tests/repo-map.test.ts` (original symlink test)
- detail: with the fixture (one `real/` dir + one `loop` symlink) at `maxDepth:6`, even a symlink-FOLLOWING walker terminates (maxDepth bounds it), so the test passed identically whether the symlink-leaf protection existed or was mutated away — the real EC-1 invariant was unproven.
- **fix:** the test now asserts the structural invariant — the symlink is listed as a LEAF (`expect(out).not.toContain("loop/")`) and `real` appears exactly once (a follower would re-list it under `loop/`). Kills the symlink-follow mutant.

### [HIGH → FIXED] EC-1 test was vacuous on no-symlink platforms
- Flagged by: test-auditor
- detail: the original `catch { return; }` silently turned the test into a zero-assertion green on any runner that denies `symlinkSync` (reported PASSED, not SKIPPED — the `rules/testing.md §6` anti-pattern).
- **fix:** a one-time `SYMLINKS_OK` capability probe + `it.skipIf(!SYMLINKS_OK)` — the test now reports SKIPPED honestly where symlinks are unavailable, runs (with the strong assertions) where they are.

### [HIGH → FIXED] Plan DoD/AC claimed knip validates the builders' wiring (vacuous)
- Flagged by: architecture+wiring
- file: plan Global DoD + Final Phase AC
- detail: the AC asserted `pnpm quality:dead` proves `buildEnvContext`/`buildRepoMap` are not orphan exports — but `sdk-tools` is not a configured knip workspace (`knip.json` lists only `sdk`+`cli`), so the result is vacuously clean and proves nothing about these exports. The export itself IS acceptable: the `no-stubs-no-mocks-no-wired.md §3` caller rule is scoped to `packages/sdk/src/**`, and the precedent is `formatCode`/`formatDiff` (also barrel-exported consumer-facing LEGO pieces with no in-SDK caller).
- **fix:** corrected the DoD/AC wording — `pnpm quality:dead` must still exit 0, but the orphan-safety evidence is now stated as the barrel re-export test + the `formatCode` LEGO precedent + the documented M8-2 future driver (not knip).

## MEDIUM findings (untested branches — RESOLVED in `ad2a68a`)

- **[FIXED] file-as-cwd branch untested** (test-auditor): `buildRepoMap` has a `!statSync(cwd).isDirectory()` guard returning `(unavailable…)`, distinct from the missing-cwd branch, with no test. Added `returns unavailable when cwd is a file`.
- **[FIXED] per-dir cap `(N more)` untested** (test-auditor): the `PER_DIR_CAP=200` elision is a distinct bounding mechanism from the char budget, never hit by the budget tests. Added a 250-entry test asserting `(50 more)`.

## LOW / INFO (advisory)

- cross-validation LOW (addressed): the dotfile filter hides ALL dot-entries (files + dirs), broader than the ADR's "+ dotdirs" text — a safe/defensible choice (hides `.env`, `.gitignore`); the docs/changeset/CHANGELOG wording was aligned to "dot-entries" for accuracy.
- architecture LOW: budget newline accounting under-counts by ≤1 char/line (harmless — makes truncation marginally more conservative; no trailing newline emitted by `join`).
- INFO confirmations: SRP/cohesion/placement clean (internal/, 162 LoC, complexity ≤ 10); DIP node:fs/path only, zero new deps; all 5 ADRs honored + Coverage Matrix 8/8 verified in code; budget/maxDepth off-by-one-free; directory symlinks genuinely not followed (`Dirent.isDirectory()` false); `buildEnvContext` has no unwrapped throwing field; never-throw contract proven by `expect().not.toThrow()` + marker assertion; changeset `@theokit/sdk-tools:minor` correct; docs/CHANGELOG/changeset accurate, no overclaim.

## Quality gate re-validation (after `ad2a68a`)

- Full sdk-tools suite: 22 files / **214 passed, 0 failed** (+15 from M3-3: 14 builder/edge + 1 barrel; symlink test SKIPPED where unavailable).
- typecheck exit 0; Biome clean (51 files, 0 warnings, complexity ≤ 10); knip exit 0; build emits ESM+CJS+DTS; code-quality PASS.

## Edge-case coverage

Plan EC-1 (symlink loop — now structurally asserted), EC-2 (line-clean truncation), EC-3 (empty dir — accepted-risk) covered, plus the review-added file-as-cwd and per-dir-cap cases.

## Verdict rationale

0 BLOCKER, 0 HIGH. The 3 HIGH (two on a weak/vacuous EC-1 test, one on a vacuous knip DoD claim) and the 2 MEDIUM untested branches are FIXED in `ad2a68a` with real tests + honest wording — not deferred (goal: no re-work, all DoDs validated). Remaining items are advisory LOW/INFO. Per `cycle-review.md § Verdicts`: **READY_TO_MERGE.**

## Recommended next step

`/release` (a `@theokit/sdk-tools` minor — additive repo-map/env-context builders). Then continue M3 with M3-4 (rich errors / self-correction on tool fail).
