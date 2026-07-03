# Release @theokit/sdk@2.18.0 (+ @theokit/sdk-cache@0.3.0)

**Date:** 2026-07-03
**Verdict:** RELEASED
**Scope:** ecosystem M3 (Harness state & observability) + M4 (Skills↔Harness provider routing)
**Source reviews:** knowledge-base/reviews/m3-harness-state-observability-review-2026-07-03.md · m4-provider-routing-apikey-fix-review-2026-07-03.md (both READY_TO_MERGE)
**Changesets consumed:** m3-62-resume, m3-64-observability, m3-66-token-undercount, m3-67-cache-revert, m4-provider-routing-apikey (5)
**PR:** https://github.com/usetheodev/theokit-sdk/pull/73 (MERGED)
**Merge commit:** 75ea2758754475893d132c50ee5f930a9937d694
**GitHub release:** https://github.com/usetheodev/theokit-sdk/releases/tag/%40theokit%2Fsdk%402.18.0
**Tag (post-merge):** @theokit/sdk@2.18.0 (Changesets per-package format)

## Bump derivation
5 changesets; highest = minor → @theokit/sdk 2.17.0 → 2.18.0; @theokit/sdk-cache → 0.3.0.

## Pre-push gate note (honest)
The pre-push gate (full monorepo turbo suite) flaked 3× on ENVIRONMENTAL parallel-load
crashes before passing clean:
1. `@theokit/cli#test` — flake (passed in isolation).
2. `jscpd` duplication — REAL finding in `agent-session-store.ts` (M3 code); FIXED via
   `rewriteLockedSession` extraction (commit 0798adc), not bypassed.
3. `@theokit/sdk-memory` segfault (exit 139) + `@theokit/sdk` crash — native-binding
   contention under turbo parallelism (both passed in isolation after `pnpm rebuild`).
Resolved by pushing with `TURBO_CONCURRENCY=1` (serialized tasks — the SAME gate, no
parallel-load contention). Gate passed clean; no `--no-verify` bypass used.

## Post-merge steps (on /release --resume after PR #73 merges)
1. Tag `@theokit/sdk@2.18.0` on the merge commit; `gh release create`.
2. Flip BOTH `## M3 — [ ]` and `## M4 — [ ]` → `[x]` in ROADMAP.md (deliberate combined
   release — single-flip invariant waived + documented here; two roadmap-runs files).
