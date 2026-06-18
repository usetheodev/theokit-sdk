# Review: monorepo-cohesion-split

**Date:** 2026-06-18
**Reviewers (spawned agents):** 4 baseline (architecture, tests, wiring, cross-validation) + 1 domain (database — false-positive domain from "schema/migration/INDEX" prose keywords; N/A, no DB changes).
**Findings:** 1 HIGH, 3 MEDIUM, 4 LOW, several INFO — **all actionable findings resolved in commit after review.**
**Verdict:** READY_TO_MERGE (one pre-existing test-infra caveat, documented).

## Findings + resolution

### HIGH — RESOLVED
- **F-xval-1** — `examples/deepagents-parity-demo/run-decorators.ts:33` imported `../../packages/di-agent/src/index.js` (a path deleted in the split) via a RELATIVE path. EC-2's package.json-dep grep + the cross-cluster guard (scopes `packages/*/src`, not `examples/`) both missed it. **Fix:** moved the di-agent decorator demo to `theokit-backend-dx/examples/` (import rewritten to `@theokit/di-agent`); removed from the Harness. Verified: `git grep` for relative imports to extracted packages under `examples/` now returns zero.

### MEDIUM — RESOLVED
- **F-arch-1** — cross-cluster guard regex `/^@theokit\/gateway(-[a-z]+)?$/` was `$`-anchored, letting gateway **sub-path** imports (`@theokit/gateway-telegram/dist/...`) slip through. **Fix:** `/^@theokit\/gateway(-[a-z]+)?(\/.*)?$/`; RED/GREEN re-verified (injected sub-path import → exit 1; clean → exit 0).
- **F-xval-3** — `.changeset/monorepo-cohesion-split.md` claimed specifiers "normalized to `workspace:^`" (reverted in the same commit) and was tagged `minor` despite removing the public `@theokit/sdk/rag` sub-path. **Fix:** retagged `major` (breaking surface removal, no-retrocompat authorized); removed the contradictory claim.
- **F-tests-1** — the validate report mis-attributed the full-suite flakiness to "vitest-4 removed `poolOptions`". The config still carries `poolOptions` (behind a `@ts-expect-error`) + `fileParallelism: false`. **Fix:** corrected the diagnosis in the validate report + implementation summary to the honest version (pre-existing native-binding contention; exact mechanism not fully pinned).

### LOW — RESOLVED / accepted
- **F-arch-2** — ADR D433 specified guard in both depcruiser + standalone; only the standalone shipped. **Fix:** ADR D431 addendum — the standalone guard is wider (scans all `packages/*/src` vs depcruiser's `packages/sdk/src`), so the dual-layer is superseded by a single-but-wider guard.
- **F-xval-5 / F-tests-2** — "11 adapters" off-by-one (actual: gateway core + 10 adapters). **Fix:** CHANGELOG corrected.
- **F-xval-4** — google-workspace went standalone instead of merging into `theokit`. **Accepted:** the plan's declared fallback (Unresolved Q2); cohesion goal met; merge is a documented follow-up.
- **F-wiring-3** — SDK `claude-template/` skill docs still advertise extracted packages as first-party. **Accepted (advisory):** template content, not `src`; cosmetic cleanup deferred.

### INFO (verified sound)
- ADR D431 decorators revocation coherent across CLAUDE.md + ADR + memory; no mandatory-decorator language remains.
- D435 reversion architecturally correct (peer deps must be semver per the publish-readiness gate; `>=1.7.0` satisfied by published `@theokit/sdk@1.9.0`).
- rag (26) + voice (5) tests GENUINELY ported (byte-identical bodies, history preserved, green in extracted repos) — not deleted.
- SDK-2.0 meta-tests updated to the new topology, NOT weakened (the load-bearing `toContain(name)` loop untouched; families test strengthened).
- All 6 extracted repos present with preserved git history; `origin` stripped (EC-1).
- No dangling deps in the 12 staying Harness packages; `pnpm install` relocks clean.

## Quality gates summary

- `pnpm build`: PASS (11/11 turbo tasks; cosmetic pnpm cycle warning non-fatal).
- `pnpm typecheck`: PASS (16/16).
- `biome check .`: PASS (2 non-blocking warnings).
- `pnpm quality` (knip + cycles + depcruise + cross-cluster + loc + duplication): **ALL PASS** (0 dead code, 1 cycle ≤ 3, 0 dep violations, guard PASS, 393 files ≤ 400 LoC, 0 clones).
- `/code-quality`: PASS (audit `audits/monorepo-cohesion-split-code-quality-2026-06-18.md`).
- Per-package tests: GREEN in isolation (sdk 2603, sdk-memory 324, + others).
- Extracted repos: backend-dx 249, gateways 543, react 34, rag 26, voice 5, skills-gw 16 — all GREEN.

## Pre-existing caveat (NOT a blocker, NOT plan-caused)

The full aggregate `pnpm test` run is flaky: a non-deterministic set of native-binding-dependent test files (sqlite-vec / better-sqlite3 / lance / bedrock-token) fails under the full-suite run, while every file passes in isolation. The failing set differs run-to-run (the signature of infra flakiness, not a deterministic break). The first full run failed ONLY the 3 plan-caused meta-tests (since fixed). Per the plan's Final-Phase contract, pre-existing issues are logged, not blocking. Recommend a separate test-infra slice to pin and fix the residual contention (out of scope for the cohesion split).

## Cross-validation summary

- Plan items: 13 tasks — 10 fully implemented, 1 partial (google-workspace destination), 2 documented divergences (D435 revert correct; voice extract within authorized branch). Coverage Matrix 11/11 mapped.
- ADRs: D431 (revoke decorators), D432 (history-preserving extraction), D433 (guard), D434 (rag/voice carve-out) implemented; D435 (specifier normalization) correctly reverted per the publish-readiness gate.

## Handoff decision

**READY_TO_MERGE.** No BLOCKER; the single HIGH and all MEDIUM/actionable-LOW findings are resolved. Open a `develop → main` release PR (human-approved) via `/release` — note the SDK bump is `major` (breaking surface removal). The pre-existing full-suite flakiness is documented and orthogonal. The 6 extracted repos are local; pushing them to their GitHub remotes (gateways + react created by the user; backend-dx/rag/voice/skills-gw still to create) is a separate outward step.

## Spawned agents (audit trail)
- `.claude/agents/review-monorepo-cohesion-split-2026-06-18/architecture.md` + findings/architecture.yaml
- `.claude/agents/review-monorepo-cohesion-split-2026-06-18/tests.md` + findings/tests.yaml
- `.claude/agents/review-monorepo-cohesion-split-2026-06-18/wiring.md` + findings/wiring.yaml
- `.claude/agents/review-monorepo-cohesion-split-2026-06-18/cross-validation.md` + findings/cross-validation.yaml
