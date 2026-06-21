---
slug: m3-repo-map
created_at: 2026-06-20
goal: Add node:fs-only, char-bounded, never-throw `buildEnvContext(cwd)` + `buildRepoMap(cwd,{budget,ignore,maxDepth})` string builders to sdk-tools (barrel-exported) that orient an LLM coding agent in one call, measured by tests/repo-map.test.ts passing green.
---

# Plan: M3-3 — Repo-map / env-context builder

> **Version 1.1** (edge-case-plan absorbed: EC-1 symlink-loop + EC-2 line-clean truncation folded into T1.1 TDD) — Close roadmap gap M3-3: ship two node:fs-only, char-bounded, NEVER-THROW string builders in `@theokit/sdk-tools` — `buildEnvContext(cwd): string` (an `<env>` block: cwd, platform/arch, node, is-git, date, project-doc heads, manifests) and `buildRepoMap(cwd, {budget, ignore, maxDepth}): string` (a char-bounded directory tree) — barrel-exported so an agent harness injects them into the system prompt to orient the LLM in one call. Design locked by blueprint `m3-repo-map` (discover-confidence SHIPPABLE 99.5, six ADRs covering signatures/env-fields/budget-ignore-depth/never-throw/placement/scope).

## Goal

> "Ship `buildEnvContext(cwd)` + `buildRepoMap(cwd,{budget,ignore,maxDepth})` in `@theokit/sdk-tools` — node:fs-only, char-bounded, never-throw — measured by `tests/repo-map.test.ts` passing green."

## Context

Roadmap gap M3-3 (`docs/gap-audit/ROADMAP.md:125`, high sev, size L, Tema C). Greenfield (confirmed): no repo-map/env-context anywhere in the SDK. The SDK ships fs primitives that return JSON and never throw on user mistakes — `createReadFileTool` (`packages/sdk-tools/src/read-file.ts:51`), `createListDirTool` (`packages/sdk-tools/src/list-dir.ts:43`), `createGlobTool` (`packages/sdk-tools/src/glob-files.ts:33`, `DEFAULT_EXCLUDES` node_modules/.git/dist/.theo at :26), `truncateOutput` (`packages/sdk-tools/src/truncation.ts:31`, byte-bounded). M3-3 follows the NEVER-THROW contract (distinct from the M3-1/M3-2 guards which throw). Two precedents: opencode `session/system.ts:67-72` (the `<env>` block) and codex `environment_context.rs` + `agents_md.rs` (env struct + project-doc discovery). Respects `rules/architecture.md` §2 + `rules/no-stubs-no-mocks-no-wired.md`. Zero new deps (node:fs/path only).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk-tools/src/internal/repo-map.ts` (NEW) | 0 | — | (the two builders) | — |
| `packages/sdk-tools/src/index.ts` | 62 | 9a7ab99 | sdk-tools barrel | additive exports only |
| `packages/sdk-tools/tests/repo-map.test.ts` (NEW) | 0 | — | unit tests — RED first | — |
| `docs.md` | (contract) | — | public API contract | additive repo-map/env-context note |
| `CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive Added entry |

### Current callers / dependents

- **NEW** `buildEnvContext`/`buildRepoMap` — exported from the barrel as reusable string builders. A consumer (agent harness) injects them into the system prompt. M8-2 (`@ProjectContext`) will later drive them. To avoid an orphan export (per `no-stubs-no-mocks-no-wired.md`), the test suite exercises both through the barrel; they are pure string builders (the "caller" is the harness/consumer + tests), analogous to `truncateOutput`/`formatCode` already exported as LEGO pieces from the barrel.
- **node:fs / node:path** — the only dependencies.

### Domain glossary

- **env-context** — a short `<env>` string block (cwd, platform, date, is-git, project docs) injected into the LLM system prompt for orientation.
- **repo-map** — a char-bounded, depth-limited directory-tree string giving the LLM a one-call view of the project layout.
- **never-throw** — every fs access is wrapped; any error yields a best-effort partial string or an `(unavailable)` marker, never an exception.
- **budget** — the max character count of the repo-map output; building stops at the budget with a truncation marker.

### Architecture boundaries affected

Per `rules/architecture.md` §2: `repo-map.ts` is pure-ish domain logic (fs reads, no network, no mutation) in sdk-tools `internal/`, barrel-exported. Sibling of the fs tools it conceptually composes. No DIP boundary crossed (node builtins only).

## Prior Art & Related Work

- **Internal blueprint** `knowledge-base/discoveries/blueprints/m3-repo-map-blueprint.md` (six ADRs — signatures, env-fields, budget/ignore/depth, never-throw, placement, scope).
- **In-repo precedent** `packages/sdk-tools/src/truncation.ts` (byte-bounded never-throw output) + `glob-files.ts` (`DEFAULT_EXCLUDES` ignore baseline) + `internal/path-guard.ts` (`isForbiddenPath`).
- **Reference precedent** opencode `session/system.ts` `environment()` (`.claude/knowledge-base/reference/opencode/packages/opencode/src/session/system.ts`); codex `environment_context.rs` + `agents_md.rs` (`.claude/knowledge-base/reference/codex/codex-rs/core/src/context/environment_context.rs`, `.../agents_md.rs`).

## Objective

- [ ] `repo-map.ts` exports `buildEnvContext(cwd): string` + `buildRepoMap(cwd, opts?): string` + option types.
- [ ] `buildEnvContext` renders an `<env>` block: cwd, platform, arch, node version, is-git (`.git` presence — no subprocess), today's date, project-doc heads (AGENTS.md/CLAUDE.md/README, bounded), detected manifests.
- [ ] `buildRepoMap` renders a depth-first directory tree bounded by `budget` (default 8000 chars) + `maxDepth` (default 4) + per-dir entry cap, with merged `ignore` (defaults + caller).
- [ ] NEVER throws — a missing/unreadable cwd or sub-dir yields a best-effort partial string / `(unavailable)` marker.
- [ ] Zero new deps; barrel exports; docs.md + CHANGELOG + changeset.
- [ ] `tests/repo-map.test.ts` green; typecheck + Biome clean; build emits dist.

## ADRs

### D1 — Two never-throw string builders (not tool factories), node:fs-only
**Decision:** ship `buildEnvContext(cwd): string` + `buildRepoMap(cwd, opts?): string` as pure-ish fs readers that NEVER throw; node:fs + node:path only, zero new deps. No `createXTool` factory in v1.
**Rationale:** mirrors opencode `environment()` (string parts) + the in-repo never-throw contract; an LLM needs orientation even when a dir is unreadable. Rule 9 / KISS.
**Alternatives considered:** throw-on-error (rejected — must degrade gracefully); a tool factory (rejected — YAGNI; v1 builders are injected into the system prompt).

### D2 — env-context field set = portable, fs-only-derivable
**Decision:** cwd, platform/arch (`process.platform`/`arch`), node version (`process.version`), is-git (`existsSync(join(cwd,".git"))`), today's date (`new Date().toDateString()`), project-doc heads (AGENTS.md/CLAUDE.md/README, first ~N chars), detected manifests (package.json/pyproject.toml/Cargo.toml/go.mod). Rendered as one `<env>` string.
**Rationale:** intersection of opencode + codex fields derivable from fs alone; drops codex sandbox `<filesystem>` + opencode plugin references.
**Alternatives considered:** shell out to `git` (rejected — needs subprocess, breaks fs-only + never-throw); copy codex's full struct (rejected — sandbox out of scope).

### D3 — repo-map bounding: char budget + maxDepth + per-dir cap + merged ignore
**Decision:** default budget 8000 chars, maxDepth 4, per-dir entry cap (200), default ignore = glob-files excludes + `.next`/`build`/`coverage`/`target`/`out` + dotdirs, merged with caller `ignore`. Depth-first, dirs first; stop at budget with a `… (truncated)` marker; elide over-cap dirs with `… (N more)`.
**Rationale:** a repo map is one prompt block → tighter than truncation's 30k; codex bounds tree scans via a max depth; glob-files defines the ignore baseline.
**Alternatives considered:** unbounded tree (rejected — blows the context window); `.gitignore` parse (rejected v1 — YAGNI).

### D4 — NEVER-THROW is the hard contract
**Decision:** wrap every `readdirSync`/`statSync`/`readFileSync`; root error → `(unavailable: <reason>)` marker; sub-dir error → skip + continue. Neither builder propagates an exception.
**Rationale:** honesty + graceful degradation for an LLM-facing orientation aid (EC-1).
**Alternatives considered:** throw on root error (rejected — a context builder must never break the agent loop).

### D5 — Placement internal/ + barrel export
**Decision:** `packages/sdk-tools/src/internal/repo-map.ts`; export `buildEnvContext`, `buildRepoMap` + option types from the sdk-tools barrel.
**Rationale:** sibling of the fs tools it composes; internal/ for logic, barrel for reuse.
**Alternatives considered:** in `@theokit/sdk` core (rejected — tooling concern belongs in sdk-tools).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A char-bounded tree omits entries — incomplete by design | Low | documented as best-effort orientation (D4); budget configurable | SDK |
| No `.gitignore` respect in v1 — may surface generated dirs | Low | hardcoded ignore covers the common offenders (node_modules/dist/build/etc); `.gitignore` deferred (D3) | SDK |
| Exported builders with no in-SDK runtime caller (consumer-facing) | Medium | barrel-exported LEGO pieces like `truncateOutput`/`formatCode`; exercised through the barrel in tests; M8-2 will drive them | SDK |

## Unresolved Questions

- (none — every decision resolved at plan time via the blueprint's six ADRs. `.gitignore` respect + a tool-factory wrapper are explicitly deferred to a later milestone — YAGNI here.)

## Dependency Graph

```
Phase 1 (buildRepoMap + buildEnvContext + tests) ──▶ Phase 2 (barrel export + docs + changeset + CHANGELOG) ──▶ Final Phase (integration validation)
```

---

## Phase 1: The builders

### T1.1 — `buildRepoMap` + `buildEnvContext` in `internal/repo-map.ts`

#### Objective
Create `internal/repo-map.ts` with the two never-throw, char-bounded, fs-only string builders.

#### Why this step (action + reasoning)
1. **What** — the pure builders: a depth-first budget-bounded tree (`buildRepoMap`) + an `<env>` field block (`buildEnvContext`), both wrapping all fs access to never throw.
2. **Why now** — it is the load-bearing correctness surface (bounding + ignore + never-throw) and is fully unit-testable against a temp dir without any network.

#### Evidence
Blueprint D1-D5 + Technique 1/2. opencode `system.ts:67-72` (env block). codex `environment_context.rs` + `agents_md.rs` (fields + project-doc). In-repo: `truncation.ts:31` (budget philosophy), `glob-files.ts:26` (ignore baseline), `path-guard.ts` (`isForbiddenPath`).

#### Files to edit
```
packages/sdk-tools/src/internal/repo-map.ts — NEW: buildEnvContext, buildRepoMap, RepoMapOptions
packages/sdk-tools/tests/repo-map.test.ts — NEW: RED tests first
```

#### Deep file dependency analysis
- `repo-map.ts` imports only `node:fs` + `node:path`. No other file changes this task. Exercised through the barrel in T2.1.

#### Pseudo-code / Signatures
```pseudocode
interface RepoMapOptions { budget?: number; ignore?: string[]; maxDepth?: number }
const DEFAULT_REPO_MAP_IGNORE = [node_modules,.git,dist,.theo,.next,build,coverage,target,out]
function buildEnvContext(cwd: string): string
  // <env> cwd, platform, arch, node, is-git (existsSync .git), date, project-docs, manifests </env>
  // every fs read in try/catch → omit field on error
function buildRepoMap(cwd: string, opts?: RepoMapOptions): string
  budget = opts.budget ?? 8000; maxDepth = opts.maxDepth ?? 4
  ignore = new Set([...DEFAULT_REPO_MAP_IGNORE, ...(opts.ignore ?? [])])
  try { walk(cwd, depth=0) accumulating lines until budget } catch { return "(unavailable)" }
  // dirs first, skip ignored + dotdirs, per-dir cap 200 with "… (N more)", stop at budget with "… (truncated)"
```

#### TDD
```
RED: test_repo_map_lists_tree() — temp dir with a/, b.txt → output contains "a" and "b.txt"
RED: test_repo_map_respects_ignore_defaults() — node_modules/ present → NOT in output
RED: test_repo_map_respects_custom_ignore() — ignore:["foo"] → foo/ omitted
RED: test_repo_map_honors_budget() — many files, budget:200 → output length ≤ ~ budget + marker AND contains "truncated"
RED: test_repo_map_honors_max_depth() — deep nesting, maxDepth:1 → deep entry absent
RED: test_repo_map_never_throws_on_missing_cwd() — buildRepoMap("/no/such/dir") → string containing "unavailable" (no throw)
RED: test_env_context_contains_core_fields() — buildEnvContext(tmp) contains cwd, "Platform", "Today's date"
RED: test_env_context_is_git_detection() — tmp with .git dir → "git repo: yes"; without → "no"
RED: test_env_context_surfaces_project_doc() — tmp with README.md → output references README
RED: test_env_context_never_throws_on_missing_cwd() — buildEnvContext("/no/such/dir") → string (no throw)
RED: test_repo_map_does_not_follow_dir_symlink_loop() — tmp with a symlink to "." → returns within budget, no hang (edge EC-1)
RED: test_repo_map_truncation_is_line_clean() — tiny budget → output ends with the truncation marker, no partial final entry (edge EC-2)
GREEN: implement repo-map.ts
REFACTOR: Biome complexity ≤ 10 (extract walk / renderEnvField helpers)
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/repo-map.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/repo-map.test.ts` reports 12/12 tests passed
- [ ] `test_repo_map_never_throws_on_missing_cwd` + `test_env_context_never_throws_on_missing_cwd` pass (D4 never-throw)
- [ ] `test_repo_map_honors_budget` + `test_repo_map_honors_max_depth` pass (D3 bounding)
- [ ] `test_repo_map_respects_ignore_defaults` passes (D3 ignore)
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check packages/sdk-tools/src/internal/repo-map.ts` reports 0 errors

#### DoD
- [ ] those tests green; `pnpm --filter @theokit/sdk-tools typecheck` exits 0

---

## Phase 2: Export + document

### T2.1 — Barrel export + docs + changeset + CHANGELOG

#### Objective
Export `buildEnvContext`/`buildRepoMap` + option types from the barrel; add docs.md note, changeset, CHANGELOG entry; integration-test the barrel surface.

#### Why this step (action + reasoning)
1. **What** — add the exports to `index.ts`; document the public surface; add a changeset + CHANGELOG entry.
2. **Why now** — per `no-stubs-no-mocks-no-wired.md` the builders need a real reachable surface (barrel + tests + docs); per CLAUDE.md docs.md reflects the public-surface change.

#### Evidence
`index.ts:25-61` (barrel). Blueprint D5. The `truncateOutput`/`formatCode` precedent (LEGO pieces exported from the barrel, `index.ts:29,53`).

#### Files to edit
```
packages/sdk-tools/src/index.ts — export buildEnvContext, buildRepoMap, RepoMapOptions
packages/sdk-tools/tests/repo-map.test.ts — add a barrel re-export test
docs.md — repo-map / env-context note
CHANGELOG.md (root) — [Unreleased] § Added entry
.changeset/m3-repo-map.md — NEW minor changeset
```

#### Deep file dependency analysis
- `index.ts` additive exports from `./internal/repo-map.js`. The barrel re-export test imports from `../src/index.js` and asserts both functions are defined.

#### TDD
```
RED: test_repo_map_symbols_exported() — import { buildEnvContext, buildRepoMap } from sdk-tools barrel → both are functions
GREEN: add barrel exports + docs + changeset + CHANGELOG
REFACTOR: none (additive)
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/repo-map.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/repo-map.test.ts` reports all tests passed (12 builder + 1 barrel)
- [ ] `test_repo_map_symbols_exported` passes (barrel)
- [ ] `grep -c "repo.map\|buildRepoMap\|env.context\|buildEnvContext" docs.md` returns ≥ 1 AND `ls .changeset/m3-repo-map.md` exists AND `grep -c "buildRepoMap\|repo-map" CHANGELOG.md` ≥ 1
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check` clean on changed files

#### DoD
- [ ] tests green; typecheck exit 0; `pnpm --filter @theokit/sdk-tools build` succeeds; docs/changeset/CHANGELOG present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No repo-map (M3-3) | T1.1 | `buildRepoMap` depth-first bounded tree (D1/D3) |
| 2 | No env-context (M3-3) | T1.1 | `buildEnvContext` `<env>` field block (D1/D2) |
| 3 | char-bounded | T1.1 | budget + maxDepth + per-dir cap (D3) |
| 4 | ignore rules | T1.1 | merged default + caller ignore (D3) |
| 5 | never-throw | T1.1 | wrapped fs access, best-effort/`(unavailable)` (D4) |
| 6 | node:fs-only, zero deps | T1.1 | node:fs/path only (D1/Rule 9) |
| 7 | is-git without subprocess | T1.1 | `.git` presence via `existsSync` (D2) |
| 8 | Document + record + export | T2.1 | barrel + docs.md + changeset + CHANGELOG + barrel test |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools exec vitest run` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk-tools exec biome check`
- [ ] Dead-code clean — `pnpm quality:dead` (knip)
- [ ] Build clean — `pnpm --filter @theokit/sdk-tools build`
- [ ] File-size budget respected (`repo-map.ts` ≤ 500, target ≤ 200)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] `docs.md` reflects the repo-map / env-context builders
- [ ] Plan-specific: tree bounded by budget/maxDepth; ignore honored; never-throws on bad cwd; is-git via fs; zero new deps
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M3-3 introduces ZERO new dependencies — node:fs + node:path builtins only (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `node:fs`, `node:path` | builtin | node | directory walk + path joins |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | A tree/ignore lib (e.g. `ignore`, `globby`) was considered + rejected: a bounded best-effort tree needs only `readdirSync` + a hardcoded ignore set (~150 lines), not a `.gitignore` engine; avoids a transitive dep. | n/a — in-house walk |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

Both builders are never-throw (D4): a missing/unreadable cwd → `(unavailable)` marker; an unreadable sub-dir → skipped, walk continues; an unreadable project-doc → that field omitted. They are pure (no network, no mutation) — there is no runtime failure mode that propagates an exception.

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/sdk-tools exec vitest run tests/repo-map.test.ts
pnpm --filter @theokit/sdk-tools exec vitest run        # full sdk-tools suite — no regression
pnpm --filter @theokit/sdk-tools typecheck
pnpm --filter @theokit/sdk-tools exec biome check
pnpm quality:dead
pnpm --filter @theokit/sdk-tools build
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/repo-map.test.ts` reports 13 tests passed (0 failed)
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run` exits 0 with 0 failed tests (full suite, no regression)
- [ ] `pnpm --filter @theokit/sdk-tools typecheck` exits 0 (0 type errors) and `pnpm --filter @theokit/sdk-tools exec biome check` reports 0 warnings
- [ ] `pnpm quality:dead` reports 0 unused exports for `buildEnvContext`/`buildRepoMap`
- [ ] `pnpm --filter @theokit/sdk-tools build` succeeds (dist emitted)
- [ ] Runtime-metric proof — N/A (pure string builders; observable via the returned `<env>`/tree string)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures. 2. Fix all plan-caused. 3. Re-run. 4. Log pre-existing in the PR.
