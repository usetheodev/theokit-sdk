# Implementation summary — monorepo-cohesion-split

**Date:** 2026-06-18
**Branch:** develop
**Plan:** `knowledge-base/plans/monorepo-cohesion-split-plan.md` (v1.1)
**Edge-case report:** `knowledge-base/reviews/monorepo-cohesion-split-edge-cases-2026-06-18.md`
**Verdict at plan-confidence:** SHIPPABLE_WITH_CAVEATS (70), Coverage 11/11

## Outcome

`@theokit/sdk` is now a cohesive Agent-AI **Harness**: the monorepo ships only 12 Harness packages. Every non-Harness cluster was extracted to a history-preserving sibling repo under `theokit-tools/`. The decorators-mandatory rule (the Backend-DX scope-creep root cause) was revoked via ADR D431.

## Monorepo after the split (12 Harness packages)

`sdk`, `sdk-cache`, `sdk-tools`, `sdk-memory`, `sdk-budget`, `sdk-handoff`, `memory-honcho`, `memory-mem0`, `memory-supermemory`, `acp`, `cli`, `codemod-sdk-2-0`.

## Extracted repos (history-preserving `git filter-repo`, build green vs npm `@theokit/sdk@1.9.0`)

| Repo | Packages | Tests | History |
|---|---|---|---|
| `theokit-backend-dx` | di, di-agent, orm | 249 (69+112+68), 2 skip | 29 commits |
| `theokit-gateways` | gateway + 10 adapters | 543 | 22 commits |
| `theokit-react` | react | 34 | 13 commits |
| `theokit-rag` | rag (was `@theokit/sdk/rag`) | 26 (ported) | 2 commits |
| `theokit-voice` | voice (was embedded) | 5 (ported) | 3 commits |
| `theokit-skills-google-workspace` | skills-google-workspace | 16 | 7 commits |

Each repo: own pnpm workspace + tsconfig.base + biome + .changeset + `.github/workflows/release.yml` (changesets + NPM_TOKEN, provenance off while private) + CHANGELOG + README. `@theokit/sdk` rewritten from `workspace:*` → `^1.9.0`; `zod` added where the SDK's runtime path needs it. EC-1 honored: `origin` stripped after filter-repo (local-only folders; GitHub repos created by the user for gateways + react).

## Per-phase result

| Phase | Task | Result |
|---|---|---|
| 0.2 | voice/rag maturity probe | Both self-contained leaves → EXTRACT. `knowledge-base/discoveries/voice-rag-maturity-probe.md`. |
| 1 | Revoke decorators rule | ADR D431 + CLAUDE.md rule 9 rewritten factory-first + memory marked REVOKED + CHANGELOG. Commit `6866cd3`. |
| 2 | Extract backend-dx | 249 tests green. |
| 3 | Extract gateways | 11 packages, 543 tests green. |
| 4 | Extract react | 34 tests green. |
| 5 | Carve rag/voice | `./rag` export + `rag/index` tsup entry + src/rag + src/voice + tests removed; depcruiser + tsconfig-dts updated; tests ported to extracted repos. sdk build + typecheck green. Commit `eb646d1`. |
| 6 | Relocate google-workspace | Standalone `theokit-skills-google-workspace` (merge into `theokit` Skills repo is a documented follow-up). |
| 7a | Trim workspace + examples | 16 dirs removed; 12 leaving-cluster examples moved to cluster repos BEFORE deletion (EC-2). Commit `b53b928`. |
| 7b | Guard + configs + docs | `tools/check-cross-cluster.mjs` (ADR D433) wired into `pnpm quality`; knip gateway entries dropped; release.yml relabel; docs.md Slack/react/di-agent sections removed/redirected. Commit `e695535`. |
| 7-fix | SDK-2.0 meta-test reconciliation | D435 reverted (peer specifiers stay `>=1.7.0` semver — publish-readiness gate requires semver, not workspace:); packages/README.md rewritten to 12-package Harness; docs-sdk-2-0 thresholds updated to new topology. Commit `b9f30a6`. |

## Wiring triad

- **Caller / runtime path:** the trimmed monorepo builds (`pnpm build` 11/11 tasks) and installs (`pnpm install` relock clean) with only the Harness set. Extracted repos build + test against the published SDK.
- **Integration test / guard:** `tools/check-cross-cluster.mjs` (RED on injected import, GREEN clean) wired into `pnpm quality`; asserts no Harness `src` imports an extracted cluster.
- **Observability:** the guard fails loud in CI; `node tools/check-cycles.mjs` gate (1 cycle ≤ 3) and `changeset status` verify topology.

## Deviations from plan (honest)

- **D435 reverted.** The plan normalized the 5 surviving `@theokit/sdk` peer specifiers to `workspace:^`. The repo's existing `sdk-2-0-npm-publish-readiness` gate REQUIRES peer deps to be a **semver range** (not `workspace:`), so the normalization was reverted to `>=1.7.0`. The changeset note flags this; the active-plan Phase B cascade is NOT re-introduced because the conflicting leaving packages are gone.
- **voice → extracted (not deleted).** Plan allowed delete-or-extract; extracted to preserve the realtime test + keep the option open.
- **google-workspace → standalone repo**, not merged into `theokit` (avoids surgical git-subtree into an unrelated repo; merge is a follow-up the user can run).
- **Gateway count:** plan said "11 adapters / 12 packages"; actual is gateway core + 10 adapters = 11 packages. Off-by-one in the plan prose; the full `gateway*` set was captured.
- **codemod / sdk-memory flakiness:** both pass in isolation; they fail intermittently under turbo parallel contention (native-binding preflight race). Pre-existing concurrency characteristic, not a defect of this change — verified by isolated re-runs (codemod 9/9, sdk-memory 324/324).

## Validation (integration)

- `pnpm build` — 11/11 tasks GREEN (cosmetic `sdk ↔ sdk-memory/sdk-handoff` pnpm cycle warning, non-fatal, unchanged).
- `pnpm typecheck` — 16/16 GREEN.
- `biome check .` — 1198 files, 2 warnings (non-blocking).
- `node tools/check-cross-cluster.mjs` — PASS (guard).
- `node tools/check-cycles.mjs` — PASS (1 cycle ≤ 3).
- `pnpm test` — all packages GREEN in isolation (sdk 2603, sdk-memory 324, others); serial full-suite run for the clean aggregate signal.
- `npx changeset status` — sdk changeset present (`minor`, breaking-surface note); pre-existing example `file:` warnings unrelated to this change.
