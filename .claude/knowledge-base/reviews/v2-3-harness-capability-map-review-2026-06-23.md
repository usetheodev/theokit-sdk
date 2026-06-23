# Review — V2-3 Theo Harness Capability Map + persistence subpath (theokit-sdk)

**Date:** 2026-06-23 · **Slug:** v2-3-harness-capability-map
**Commits:** `edbc3c2` (map + persistence subpath) · `ed6c519` (review fix — server/* coverage + CI wording)
**Reviewers:** 2 independent agents (promotion+resolve · completeness+honesty+cross-validation)
**Code-quality:** PASS (theokit-sdk languages.txt empty → detector-vacuous; substantive validation below is the real gate).
**Verdict:** **READY_TO_MERGE** (0 BLOCKER, 0 HIGH, 0 open MEDIUM — 1 MEDIUM found & fixed; LOWs addressed)

## Live verification (both agents, reproduced on `ed6c519`)
| Check | Result |
|---|---|
| `pnpm --filter @theokit/sdk build` | ✅ green; `dist/persistence.{js,cjs,d.ts,d.cts}` all present |
| `@theokit/sdk/persistence` runtime resolve | ✅ all 10 fns + JsonlParseError resolve |
| `.d.cts` is a real declaration | ✅ (not empty; CJS types condition resolves) |
| capability-map resolve-check | ✅ 126/0 (89 sdk + 37 sdk-tools symbols; exit 0) |
| all 21 public subpaths covered | ✅ NONE missing |
| `pnpm --filter @theokit/sdk typecheck` | ✅ 0 |
| full suite | ✅ 2871 passed / 35 skipped (0 failed) |
| biome (new src+test) | ✅ clean |
| persistence subpath test | ✅ 3/3 (real jsonl persist→resume + atomic write→read round-trips) |

## What shipped
- **(A) `docs/harness-capability-map.md`** — navigable inventory of every harness primitive (126 symbols across 21 `@theokit/sdk` subpaths + `@theokit/sdk-tools`) with resolvable import + signature + example; OUT-OF-REPO primitives (ui/client/orm/memory/budget/agents/theo) as repo pointers (NOT fabricated as `@theokit/sdk` imports); 3 runtime-behavior gaps documented honestly with no invented imports. Linked from both package READMEs. Backed by the committed `scripts/check-capability-map.mjs`.
- **(B) `@theokit/sdk/persistence`** — promoted the consumer-grade cluster (jsonl persist/resume, atomic write, file lock, resilient sqlite) from the semver-exempt `internal/persistence` to a STABLE public subpath. Re-export only (no new logic — both agents confirmed). Full ceremony: src barrel + tsup entry + tsc-DTS (tsconfig.tools-dts + mirror-dts-to-cts) + package.json exports + docs.md section + subpath test + changeset (`@theokit/sdk` minor). Closes the theocode V2-2E-1/V2-2F-2 follow-up.

## Findings & resolution
- **M-1 (MEDIUM → fixed `ed6c519`):** the map omitted two real public subpaths `@theokit/sdk/server/auth` + `@theokit/sdk/server/errors-envelope`. **Fix:** added a Server-side section (`defineAuth`/`validateReturnTo`/`toEnvelope`/`fromEnvelope` + auth error classes). Completeness scan now reports NONE missing (all 21 public subpaths); resolve-check 126/0.
- **L-1 (fixed `ed6c519`):** the map said "verified in CI" but the resolve-check isn't CI-wired yet. **Fix:** reworded to "verified by the committed resolve-check … intended to be wired into CI."
- **L-2 (accepted):** the SQLite trio in the subpath test is asserted `typeof === function` (not a behavior round-trip) — acceptable for a subpath-contract test (native binding has its own internal tests). jsonl + atomic-write DO round-trip.

## DoD + Coverage
Coverage Matrix 6/6 mapped to real artifacts (both agents). ADRs D1 (re-export-only stable subpath), D2 (grounded + honest), D3 (scope persistence-only) honored; EC-1 (tsc-DTS) absorbed. DoD triple verified: `compactTranscript`/`buildRepoMap`/`isTransientError` documented with correct import paths, all resolve. CHANGELOG + changeset + README links present. No unrelated files in the commit (no examples bumps, no `__pycache__`, no `dist/`). No regression (2871 tests).

## Conclusion
A discoverability milestone that makes every harness primitive findable with a resolvable import (machine-checked 126/0) and promotes the persistence cluster to a stable public home — closing the V2-2 follow-up. The map is honest about what is out-of-repo and what is wired-but-not-exported. **READY_TO_MERGE.**
