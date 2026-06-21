# Review: m3-rich-errors

**Date:** 2026-06-21
**Reviewers (spawned agents):** 3 — architecture+wiring, test-auditor+behavior, cross-validation (general-purpose, opus-class)
**Findings (initial):** 0 BLOCKER, 1 HIGH (dead `no_matches` hint), 2 MEDIUM (untested non-string-guidance overwrite + doc overclaim), LOW/INFO
**Findings (after fix `c171b83`):** 0 BLOCKER, 0 HIGH, 0 MEDIUM (all fixed with tests), advisory LOW/INFO only
**Verdict:** READY_TO_MERGE

> Per-agent finding files: `.claude/agents/review-m3-rich-errors-2026-06-21/findings/*.md`.

## Scope reviewed

Commits `60f287b` (T1.1) + `5c40feb` (T2.1) + review-fix `c171b83`, on `develop` vs `main`. Files: `packages/sdk-tools/src/internal/tool-guidance.ts`, `glob-files.ts` (stale comment), `index.ts`, `tests/tool-guidance.test.ts`, `docs.md`, root `CHANGELOG.md`, `.changeset/m3-rich-errors.md`.

## HIGH findings (RESOLVED in `c171b83`)

### [HIGH → FIXED] `no_matches` was a DEAD hint (no tool emits it)
- Flagged by: cross-validation
- file: `packages/sdk-tools/src/internal/tool-guidance.ts` (original `DEFAULT_TOOL_GUIDANCE.no_matches`)
- detail: `glob_files` returns `{ok:true, files:[], count:0}` on an empty match — it NEVER returns `{ok:false, error:"no_matches"}`. The code `no_matches` survived only in a stale doc comment (`glob-files.ts:9`). So the hint was doubly dead: no emitter, and unreachable even by a hand-built payload (`ok:true`). The blueprint + plan both prescribed it — a plan↔impl divergence rooted in a wrong assumption about glob's empty-result shape.
- **fix:** removed the dead `no_matches` hint; added `invalid_url` instead (a real, user-correctable code emitted by `web_fetch`); fixed the stale `glob-files.ts:9` comment; added a "no dead hints" regression test asserting `DEFAULT_TOOL_GUIDANCE.no_matches` is undefined. All 10 remaining hints map to a real emitted code (verified by grep).

## MEDIUM findings (RESOLVED in `c171b83`)

- **[FIXED] non-string existing `guidance` silently overwritten + untested** (test-auditor): the idempotency guard `typeof parsed.guidance === "string"` let a malformed `guidance:123` be overwritten, and the branch was untested. Changed the guard to `"guidance" in parsed` (key-presence — never touch an existing `guidance` key) + added a regression test.
- **[FIXED] docs/changeset overclaimed `no_matches`** (cross-validation): both advertised the dead code as "common/covered". Replaced with `invalid_url` across docs.md + changeset (the CHANGELOG entry carried no explicit code list).

## LOW / INFO (advisory — addressed where cheap)

- test-auditor LOW (addressed): added a synchronous-handler wrapper test (proves `await` resolves a plain-string handler), a custom-map end-to-end test through the wrapper, and an `ok`-absent/non-boolean passthrough test.
- architecture LOW: knip is non-probative for `sdk-tools` (not a configured workspace) — the wiring evidence is the real-tool integration test (`withDefaultGuidance(createReadFileTool(...))`) + the `formatCode`/`buildRepoMap` LEGO precedent; `no-stubs §3` is scoped to `packages/sdk/src`. Sufficient.
- INFO confirmations: object-literal-over-`defineTool` is the correct DIP-preserving choice (inputSchema is already JSON Schema; `defineTool` would double-convert) — contract faithfully preserved; SRP/cohesion/placement clean (81 LoC, complexity ≤ 10); zero new deps (type-only `CustomTool` import); strict `=== false` semantics correct; no prototype-pollution path; all 5 ADRs honored + Coverage Matrix 8/8; changeset `@theokit/sdk-tools:minor` correct; no scope creep.

## Quality gate re-validation (after `c171b83`)

- Full sdk-tools suite: 23 files / **231 passed, 0 failed** (+17 from M3-4: 16 guidance + 1 barrel).
- typecheck exit 0; Biome clean (53 files, 0 warnings, complexity ≤ 10); knip exit 0; build emits ESM+CJS+DTS; code-quality PASS.

## Edge-case coverage

Plan EC-1 (non-object JSON passthrough) covered, plus the review-added non-string-guidance idempotency, ok-absent/non-boolean passthrough, sync-handler, custom-map e2e, and no-dead-hints cases.

## Verdict rationale

0 BLOCKER, 0 HIGH. The HIGH (dead `no_matches` hint — a real plan↔impl divergence) and both MEDIUM (untested overwrite branch + doc overclaim) are FIXED in `c171b83` with regression tests + honest hint curation — not deferred. Remaining items are advisory LOW/INFO. Per `cycle-review.md § Verdicts`: **READY_TO_MERGE.**

## Recommended next step

`/release` (a `@theokit/sdk-tools` minor — additive tool-guidance wrappers). Then continue M3 with M3-5 (ACI description override + render `<tools>`).
