# Review: system-design-audit-fixes (SE43)

**Date:** 2026-07-16
**Reviewers (spawned agents):** 5 — architecture, cross-validation, wiring, tests, domain-infrastructure (parallel)
**Diff base:** `3ea9e53b..HEAD` (9 SE43 commits, 107 files)
**Findings:** BLOCKER 0 · HIGH 1 (addressed) · MEDIUM 3 (2 resolved, 1 deferred) · LOW 5 (documented) · INFO many
**Verdict:** READY_TO_MERGE

## Verdict rationale

0 BLOCKER. The single HIGH (F-wire-2) is a coverage-philosophy call the project's own `testing.md § 4` resolves as impl-detail (the tests-agent independently rated the same issue LOW); it was addressed by an honest CHANGELOG correction. All 3 MEDIUM were either resolved (changeset, orphan barrel) or deferred with a tracked follow-up (F-arch-1 → SE44). Per `cycle-review § Verdicts`, this is READY_TO_MERGE.

## Findings + disposition

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| F-wire-2 | HIGH→LOW | `sdk-memory-peer-loader.test.ts` deleted (not relocated); 3 white-box loader assertions lost | ADDRESSED — peer-present *load* path transitively covered by relocated Memory/migrate tests; the 3 lost assertions are impl-detail per `testing.md § 4`; CHANGELOG corrected to stop overstating coverage (commit `453ad2db`). Both reviewers agreed it is not a hidden bug. |
| F-xval-1 | MEDIUM | No changeset for the public-surface change (plan DoD required it) | RESOLVED — added `.changeset/se43-system-design-audit-fixes.md` (sdk minor, satellites patch) in `453ad2db`. |
| F-arch-2 / F-wire-1 | MEDIUM | `internal/session` barrel was orphan (0 importers) | RESOLVED — routed its 9 cross-module consumers through the barrel (now consumed, consistent with cloud-agent/local-agent barrels); typecheck clean, madge 3/3, depcruise 0 viol (`453ad2db`). |
| F-arch-1 | MEDIUM | local-agent split *relocated* but did not *decouple* the `fork-agent ↔ local-agent` bidirectional value edge | DEFERRED — non-blocking; SE43's scope was byte-stable relocation (confirmed by madge 3/3 unchanged + depcruise clean). Filed as an SE44 follow-up to invert the edge via a neutral leaf. cloud-agent got the one-way model right (F-arch-6). |
| F-xval-2 / F-tests-4 | LOW | Plan named 4 tests to relocate; 3 moved + 1 deleted | DOCUMENTED — CHANGELOG corrected to say "relocated 3, deleted 1 white-box loader test". |
| F-tests-5 | LOW | Removing `test_resetForTests_clears_forced_absent_flag` drops the reset→re-loadable isolation guard | DOCUMENTED — `resetSdkMemoryPeerCacheForTests()` still runs in `afterEach`; the peer-present assertion genuinely can't relocate (internal loader + needs peer). Noted honestly in CHANGELOG. |
| F-wire-3 | LOW | `sdk-handoff` absent from peer-tests pkg devDeps (plan named it) | BENIGN — sdk-handoff was never imported (dropped as unused in `930b8b21`); plan text reconciled. |
| F-tests-6, F-dom-1..7, F-arch-4..6 | INFO | Positive confirmations (byte-stable API, publint/attw clean, 0 Circular, private test pkg, peer floors correct, no stale runtime paths) | — |

## Honesty checks (cross-validation agent, live-verified)

- **EC-1** deprecated alias preserves FULL surface — TRUE (byte-identical except `@deprecated` banner).
- **EC-2** relocated peer tests run ≥4 before devDeps removed — TRUE (13 tests green live).
- **"no public-API change"** — TRUE (`exports` map + `src/index.ts` byte-identical).
- **"internal/runtime shrank ~4327 LoC"** — TRUE (111→85 files, −4,327 LoC).
- **#128 catalog drift** — HANDLED HONESTLY (documented + filed, parity assertion corrected to the true invariant, not hidden).

## Quality gates (definitive `pnpm -w run validate` → exit 0)

full sdk suite 3509 passed / 0 fail · turbo build 0 Circular · madge 3/3 · dependency-cruiser 0 violations · knip clean · publint "All good!" · attw OK · bundle-budget 5/5 · real-LLM smoke (OpenRouter) Status: finished.

## Spawned agents (audit trail)

`.claude/agents/review-system-design-audit-fixes-2026-07-16/{architecture,cross-validation,wiring,tests,domain-infrastructure,domain-database,domain-concurrency}.md` + `findings/*.yml`

## Handoff decision

**READY_TO_MERGE** → proceed to `/release`.
