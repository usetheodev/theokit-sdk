# Review: m2-compaction-public-api

**Date:** 2026-06-20
**Reviewers (spawned agents):** 5 — architecture, tests, wiring, cross-validation, domain-api-design (general-purpose, opus-class)
**Findings (initial):** 0 BLOCKER, 0 HIGH, 3 MEDIUM (2 distinct root causes), 3 LOW, 15 INFO
**Findings (after fix commit `9586ab8`):** 0 BLOCKER, 0 HIGH, 0 MEDIUM, 0 actionable LOW, 15 INFO
**Verdict:** READY_TO_MERGE

> The per-agent finding files are at `.claude/agents/review-m2-compaction-public-api-2026-06-20/findings/*.md` (consolidate_findings.py under-parses the `## [SEVERITY]` shape — known aggregator limitation; this report consolidates the agents' returned summaries faithfully).

## Scope reviewed

Commits `1fdfff0` (Phase 1: T1.1+T1.2) + `5b8c9e7` (T2.1 wiring) on `develop` vs `main`, plus the review-fix `9586ab8`. Files: `packages/sdk/src/compaction.ts`, `tests/compaction*.test.ts`, the subpath wiring (`package.json`, `tsup.config.ts`, `tsconfig.tools-dts.json`, `scripts/mirror-dts-to-cts.mjs`), `docs.md`, CHANGELOG, changeset.

## BLOCKER / HIGH findings

_None._

## MEDIUM findings (both RESOLVED in `9586ab8`)

### [MEDIUM → FIXED] Checkpoint markers survived `compactTranscript` as system prompts
- Flagged by: architecture, tests (MEDIUM), domain-api-design (LOW)
- file: `packages/sdk/src/compaction.ts:44` (original)
- detail: `compactTranscript` filtered `m.role === "system"` into the always-preserved set; since `buildCheckpoint` emits `role:"system"` markers, checkpoint markers were preserved verbatim through compaction (polluting compacted output). The plan's T1.2 pseudo-code had a `!startsWith(CHECKPOINT_MARKER)` guard that the implementation dropped; no test covered the compact+checkpoint interaction.
- **fix (`9586ab8`):** introduced `isSystemPrompt()` (a `system` turn that is NOT a checkpoint marker). `compactTranscript` now preserves only real system prompts; checkpoint markers flow through the keep-recent window as ordinary turns (older → summarized/dropped, recent → kept). +2 regression tests (`test_compactTranscript_drops_old_checkpoint_marker_keeps_system_prompt`, `test_compactTranscript_keeps_recent_checkpoint_marker`). docs.md updated.

### [MEDIUM → FIXED] `CHECKPOINT_MARKER` used invisible NUL-guard bytes
- Flagged by: domain-api-design (MEDIUM; the "whitespace-fragile" framing was a Read-tool misrender — the bytes were actually `\0`-guarded per the wiring agent's `od -c`)
- file: `packages/sdk/src/compaction.ts:24` (original)
- detail: the marker was `"\0theokit:checkpoint\0 "` — collision-proof but invisible in source (a maintainer sees spaces) and a persistence footgun (NUL bytes are rejected by some text stores / stripped by some editors).
- **fix (`9586ab8`):** replaced with a visible, structured, prose-unlikely token `"[[theokit:checkpoint]] "` — no invisible/control bytes, safe to persist and read in source; only `buildCheckpoint` produces it (documented). Tests use `CHECKPOINT_MARKER`/`buildCheckpoint` (not the literal), so they were robust to the value change.

## LOW / INFO findings (advisory)

- The pre-fix LOW findings (filter style, marker design) are subsumed by the two fixes above. Remaining INFO across the 5 agents (15) are positive confirmations:
  - **DIP clean** (architecture): `compaction.ts` imports only `TheokitAgentError` (public root) + `selectCompressionWindow`/`CompressibleMessage` (internal/runtime/compression — the same allowed reach as retry/concurrency). No reach into other internals.
  - **DRY confirmed** (architecture, wiring, cross-validation): `selectCompressionWindow` reused (not reimplemented); default `keepRecent=6` matches internal `preserveLast=6`.
  - **LSP** (architecture): `instanceof TheokitAgentError` covers subclasses (`RateLimitError`), exercised by a test.
  - **Wiring complete** (wiring): all 4 config files mirror retry/concurrency tsc-DTS pattern; build emits `dist/compaction.{js,cjs,d.ts,d.cts}`; attw `@theokit/sdk/compaction` 🟢 node16 CJS/ESM/bundler (node10 💀 = pre-existing package-wide baseline); dep-cruiser 0 violations (compaction.ts has value edges → not orphan, no exclusion needed).
  - **Faithful** (cross-validation): all 3 tasks delivered, 6/6 Coverage Matrix, all 5 ADRs honored, both baseline corrections hold (CompressibleMessage unit; tsc-DTS path), zero new deps (`dependencies` unchanged), no plan drift (plan frozen `c8f031a` before first impl commit).
  - **API sound** (domain): verb-first free functions matching `withRetry`/`mapWithConcurrency`; `CompactTranscriptOptions` exported in parity with `RetryOptions`; `CompressibleMessage` re-exported; docs.md matches signatures + example type-checks; always-async return is the right contract.

## Quality gate re-validation

- Full SDK suite: 375 files / 2758 passed, 35 skipped, **0 failed** (+23 from the M2-1 work: 21 unit + 2 wiring; 2 of the 21 are the review regression tests).
- Typecheck exit 0; Biome clean; knip clean; dep-cruiser clean; build clean (4 dist artifacts); attw `./compaction` 🟢 node16.

## Edge-case coverage

Plan edge cases EC-1 (empty/only-system), EC-2 (marker-last), EC-3 (subclass-overflow) all covered, plus the 2 review-added checkpoint×compaction regression tests. No missing scenario.

## Verdict rationale

0 BLOCKER, 0 HIGH. The 2 MEDIUM root causes surfaced by the review are FIXED in `9586ab8` with regression tests, not deferred (goal: no re-work, all DoDs validated). Per `cycle-review.md § Verdicts`: **READY_TO_MERGE.**

## Recommended next step

`/release` — opens PR `develop → main` (bundled with M1-4/M1-5 already on develop if not yet released; or a fresh minor if v3.0.0 already merged). M2-1 closes roadmap gap (Tema B compaction).
