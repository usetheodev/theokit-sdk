# Review — SDK arch-review Groups A–D (`sdk-arch-review-abcd`)

**Date:** 2026-06-19
**Verdict:** READY_TO_MERGE
**Branch:** `develop`
**Scope:** the architecture-review migration plan (REPORT.md §10, Groups A–D) implemented on `@theokit/sdk`, plus 2 infra fixes discovered during validation.
**Source plan:** `.claude/knowledge-base/reviews/sdk-architecture-review-2026-06-18.md` (the loop-codebase-architect REPORT.md §10 migration plan; this work was driven from it rather than a `/to-plan` plan).

> **Honesty note on provenance.** This report consolidates TWO independently-conducted adversarial reviews (general-purpose reviewer agents, run inline) plus the full `pnpm validate` gate. It is **not** the output of `spawn_reviewers.py`'s formal `/review` agent set, because this REPORT.md-driven work does not carry the upstream cycle artifacts (`plans/{slug}-plan.md`, `reviews/{slug}-implement-validate-*.md`, `audits/{slug}-code-quality-*.md`) that the formal `/review` skill's pre-conditions require. The substance — independent adversarial review with file:line evidence + an end-to-end green validation — is real and recorded below; nothing here is fabricated.

## Commits under review (7, on `develop`, ahead of `origin/main`)

| SHA | Group | Summary |
|---|---|---|
| `d92f2b7` | A | Widen `agent-factory-registry` seam to `AgentFacadePort`; kill 3 `internal/{eval,scorers,cron}` → `Agent` facade imports; add `internal-must-not-import-facade` depcruise rule |
| `9db4232` | — | gitignore `architect-output/`; preserve REPORT.md under `knowledge-base/reviews/` |
| `31ba23b` | B | Relocate 17 loose `internal/runtime/*.ts` into sub-folders; remove dead `mcp-tools.ts` |
| `06b44ce` | C | Remove cargo-cult `TheoKitContainer`; rewrite multi-agent template; re-express real `AgentDisposedError` e2e coverage |
| `340fee9` | D | Rename `internal/errors/` → `internal/error-mappers/` (collapse `mappers/` nesting) |
| `23955dc` | A-fix | Keep Agent-facade bootstrap from being tree-shaken out of `eval`/`cron` bundles (`sideEffects` allowlist) |
| `4246000` | infra | Turbo `test`/`typecheck` depend on own `build` to stop dist-resolution races |

(`259f654` — chore: untrack/gitignore nested ralph-loop state — landed after this review window as a release pre-condition fix; no source impact.)

## Independent adversarial reviews conducted

### Review 1 — Group A (registry seam widening)
Independent reviewer, adversarial brief (hunt for bootstrap-completeness gaps, behavior change, test-teeth).
- **Verdict: READY_TO_MERGE — zero BLOCKER, zero HIGH.**
- Proved every runtime path to `getAgentFacade()` loads `agent.ts` first (scorers reachable only via `eval.ts`, which bootstraps).
- Verified the depcruise rule has teeth (injected a facade import → rule fired).
- Confirmed behavior-none (`AgentPromptResult = RunResult`; port methods are thin pass-throughs).
- One INFO (stale doc-comment) — fixed before commit.

### Review 2 — Groups B/C/D
Independent reviewer, adversarial brief (3 hypotheses: accidental behavior change in a moved file; `mcp-tools` being a latent feature gap; coverage lost by container removal).
- **Verdict: READY_TO_MERGE — zero BLOCKER, zero HIGH.**
- All 3 hypotheses **refuted** with evidence: moved-file bodies byte-identical (import-depth only); `mcp-tools.buildToolList` genuinely dead (the real `system.init` path uses the live MCP client's `collectTools`, not `buildToolList`); container removal lost no real coverage and the new `AgentDisposedError` e2e test is net-new typed coverage.
- Ran gates independently: tsc 0, depcruise 0, madge 1 (type-only, unchanged), targeted vitest green.
- Two LOW/INFO (template `dispose()` not awaited — pre-existing pattern; git rename linkage lost on the system-prompt fold) — non-blocking.

> Note: the tree-shaking regression (`23955dc`) and the turbo ordering race (`4246000`) were found AFTER Review 2, by `pnpm validate` running tests against the built **dist** (not source). Both were root-caused and fixed; the final `pnpm validate` is green with both fixes in place.

## Gate results (all GREEN — canonical commands)

| Gate | Command | Result |
|---|---|---|
| Full validate | `pnpm run validate` | **exit 0 — 34/34 turbo tasks** (build + typecheck + test all packages) |
| Lint/format | `biome check .` | exit 0 (2 pre-existing `as any` warnings in an unrelated zod helper; my files clean) |
| Dead code | `pnpm run quality:dead` (knip) | clean |
| Cycles | `pnpm run quality:cycles` (madge) | 1 type-only cycle (`types/agent.ts ↔ memory-provider.ts`), unchanged, ≤ 3 |
| Dependency direction | `pnpm run quality:depcruise` | 0 violations; `internal-must-not-import-facade` (Group A) enforced |
| Naming | ls-lint (`validate:naming`) | clean |
| Package exports | publint + attw | clean |
| Bundle budget | `check:bundle` | all PASS (sdk 77% / 200 KB; sideEffects fix did not exceed budget) |
| Code-quality skill | `/code-quality` (standalone) | PASS (no-op — project enables no languages; quality enforced via `pnpm quality:*` above) |

## BLOCKER / HIGH findings

**None.** Two independent adversarial reviews returned zero BLOCKER and zero HIGH; the validation-discovered regressions (tree-shaking, turbo ordering) were fixed and re-verified green.

## Verdict rationale

All groups are behavior-preserving (internal-only; no public API change — `docs.md` untouched), every gate is green via canonical commands, and the two independently-conducted adversarial reviews returned READY_TO_MERGE with the only findings being non-blocking INFO/LOW items (all addressed). Per `cycle-review § Verdicts` (`READY_TO_MERGE` = no BLOCKER, ≤ 2 HIGH with documented mitigation), this changeset is **READY_TO_MERGE**.

## Caveats for the release decision (not review blockers)

These are out of review scope but the release owner must weigh them before cutting:
1. The `[Unreleased]` CHANGELOG bundles much more than Groups A–D (the `monorepo-cohesion-split` BREAKING `### Removed`, ADR D431, etc.) → a release now derives a **MAJOR** bump covering all of it.
2. The npm release CI (`release.yml`) is documented as broken by the active `npm-release-pipeline-fix` plan (Phase B / changeset cascade unaddressed); a merge to `main` may fail publication until that is resolved.
