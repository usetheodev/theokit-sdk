# Discovery Plan: M3-3 — Repo-map / env-context builder

> **Version 1.0** — Investigate how codex (`environment_context.rs` struct+render + `agents_md.rs` project-doc discovery) and opencode (`session/system.ts` `environment()` `<env>` block) build the environment/project context fed to an LLM coding agent, plus the in-repo sdk-tools fs primitives (read-file/list-dir/glob-files/truncation) to mirror, to design `buildEnvContext(cwd)` + `buildRepoMap(cwd, {budget, ignore})` — node:fs-only, char-bounded, NEVER-THROW. codex provides the env-context content + project-doc precedent; opencode the concrete `<env>` block shape; the in-repo tools the JSON-return + ignore + truncation building blocks. Blueprint output: the two function signatures, the env-context fields, the repo-map char-budget + ignore + depth strategy, and the never-throw contract.

**Slug:** `m3-repo-map`
**Owner:** paulo
**Created:** 2026-06-20
**Time budget:** 3h (per-project breakdown in ADR D1)

## Context

Roadmap gap M3-3 (`docs/gap-audit/ROADMAP.md:125`, high sev, size L, Tema C). Baseline (confirmed greenfield via Explore): NO `buildRepoMap`/`buildEnvContext`/repo-map/env-context anywhere in `packages/sdk/` or `packages/sdk-tools/`. The SDK ships fs primitives a repo-map builds on — `createReadFileTool` (`packages/sdk-tools/src/read-file.ts:51`), `createListDirTool` (`packages/sdk-tools/src/list-dir.ts:43`), `createGlobTool` (`packages/sdk-tools/src/glob-files.ts:33`, default-ignores node_modules/.git/dist/.theo), `truncateOutput` (`packages/sdk-tools/src/truncation.ts:31`, byte-bounded never-throw), `isForbiddenPath` (`packages/sdk-tools/src/internal/path-guard.ts`). These return JSON `{ok,...}` and never throw on user mistakes — the contract M3-3 must follow (distinct from M3-1/M3-2 guards which throw). codex's `environment_context.rs` + `agents_md.rs` and opencode's `session/system.ts` `environment()` are the two independent precedents for what an env/project-context block contains. The roadmap scopes M3-3 as `buildEnvContext(cwd)` + `buildRepoMap(cwd,{budget,ignore})`, node:fs-only, char-bounded, never-throw, to orient an LLM in ONE call. Respects `rules/architecture.md` §2 + `rules/no-stubs-no-mocks-no-wired.md`.

## Objective

Decide the `buildEnvContext(cwd)` and `buildRepoMap(cwd,{budget,ignore})` signatures, the env-context field set, the repo-map char-budget + ignore + max-depth strategy, and the never-throw contract — backed by codex's env-context/project-doc, opencode's `<env>` block, and the in-repo fs primitives. Success criteria:

- [ ] All research questions answered with citations to `.claude/knowledge-base/reference/` + in-repo
- [ ] Cross-cutting comparison populated (codex / opencode / in-repo fs-tools)
- [ ] Recommendations give ≥ 1 concrete proposal per question (esp. env-context fields + repo-map budget/ignore)
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/reference/codex/` | `codex-rs/core/src/context/environment_context.rs`, `codex-rs/core/src/agents_md.rs`, `codex-rs/protocol/src/protocol.rs` | The env-context struct+render + project-doc (AGENTS.md) discovery + the `<environment_context>` tag convention |
| `.claude/knowledge-base/reference/opencode/` | `packages/opencode/src/session/system.ts` | The concrete `environment()` `<env>` block (cwd, workspace root, is-git, platform, date, project structure) |
| (in-repo) `packages/sdk-tools/src/{read-file,list-dir,glob-files,truncation}.ts` + `internal/path-guard.ts` | — | The fs primitives + ignore + byte-bounded-never-throw building blocks to compose |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/reference/adk-js/`, `crewAI/` | No repo-map / env-context builder found (baseline confirmed) |
| codex's permission-profile / sandbox filesystem context (`FileSystemContext`) | M3-3 is fs-only context for the LLM, not a permission model; sandbox is out of scope |
| `.gitignore` parsing | YAGNI for v1 — hardcoded ignore list (node_modules/.git/dist/.theo + dotfiles) mirrors glob-files; .gitignore parse deferred (documented) |
| `.claude/knowledge-base/reference/*/{node_modules,dist,target,build}/` | Build artifacts |

## ADRs

### D1 — Time budget + stop conditions
**Decision:** codex env-context + agents_md: 1.25h, opencode system.ts: 0.75h, in-repo fs-tools + truncation: 1h.
**Rationale:** codex is the deepest content source (struct fields + project-doc); opencode gives the concrete block layout; the in-repo tools are already known.
**Stop condition — per question:** empty search after 3 variants → BLOCKED, continue. **Per project:** budget exhausted → mark remaining BLOCKED; if all done/blocked, emit BLUEPRINT_BLOCKED.
**Anti-pattern:** NEVER design a builder that throws — M3-3 is never-throw (JSON/string return), mirroring read-file/list-dir, NOT network-guard/shell-guard.

### D2 — Investigation depth
**Decision:** Read codex `environment_context.rs` end-to-end for the field set + render shape; read `agents_md.rs` for project-doc discovery; read opencode `system.ts` `environment()` for the `<env>` block; map onto the in-repo fs primitives + truncation for the char-budget + ignore.
**Rationale:** the env-context field set + the char-budget/ignore strategy are the high-value outputs.
**Consequences:** the SDK adopts a curated env-context field set (cwd, OS/platform, is-git, date, manifests, AGENTS.md/README) + a depth/char-bounded repo-map; permission/sandbox context excluded.

## Research Questions

| # | Question | Corner | Reference(s) | Fase A (broad) | Fase B (deep Read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How do codex/opencode TEST their env-context / project-doc building? | tests | codex, opencode | Grep `#[test]` near environment_context + agents_md; opencode system tests | Read codex `agents_md_tests.rs` + any environment_context tests | Table: test → asserted shape → seeds SDK RED tests (env block contains cwd/platform/date; repo-map bounded; never-throws on bad cwd) |
| Q2 | What does each env/repo-map builder DEPEND on? Can the SDK do it node:fs-only, zero deps? | deps | codex, opencode, in-repo | Read imports of environment_context.rs + system.ts | Compare to in-repo read-file/list-dir (node:fs/path only) | Verdict: SDK uses node:fs/path only (KISS, Rule 9); opencode uses ripgrep/Effect (heavier, not portable); codex uses Rust std — SDK needs neither |
| Q3 | What is the module/export shape (function signatures, return type) for env-context + repo-map? | tools | codex, opencode, in-repo | Read exported fns/structs | Read `environment_context.rs:19-29,144` (render) + `system.ts:52-72` + `truncation.ts:31` | Module shape → `buildEnvContext(cwd):string` + `buildRepoMap(cwd,{budget,ignore}):string` in `sdk-tools/src/internal/repo-map.ts`, barrel-exported; never-throw (returns a best-effort string) |
| Q4 | ENV-CONTEXT FIELDS: which fields belong in the env block (cwd, OS/platform, is-git, date, shell, manifests, AGENTS.md/README)? | techniques | codex, opencode | Read `system.ts:67-72` `<env>` block + environment_context.rs struct | Map codex fields + opencode `<env>` onto an SDK field set; decide which are fs-only-derivable | The env-context field set with sources → drives the buildEnvContext design |
| Q5 | REPO-MAP STRATEGY: char/budget bound + ignore rules + max-depth + never-throw — how to bound a directory tree fed to an LLM? | techniques | codex, opencode, in-repo | Read truncation.ts byte-bound + glob-files ignore defaults | Read `truncation.ts:15-56` + `glob-files.ts:26` + opencode tree/ignore | Budget algorithm (char cap, max-depth, max-entries-per-dir, hardcoded ignore) + never-throw (catch-all → best-effort partial string); the `{budget,ignore}` option contract |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1 | Covered |
| Dependencies | Q2 | Covered |
| Tools | Q3 | Covered |
| Techniques | Q4, Q5 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | every cited path (reference + in-repo) exists | mark Qx BLOCKED, continue |
| After answering Qx | the Qx section has ≥ 1 citation | re-iterate (1 retry) |
| Q4 env-fields gate | the field set is fs-only-derivable (cwd, platform, is-git via .git/ presence, date, manifests, AGENTS.md/README) — NO external process required | re-iterate; drop any field needing a subprocess |
| Q5 never-throw gate | the design wraps all fs access so a bad/missing cwd or unreadable dir yields a best-effort partial string, never an exception | re-iterate; record the catch-all contract |
| Q5 budget gate | the design states a char budget + max-depth + per-dir entry cap + hardcoded ignore (mirrors truncation.ts + glob-files.ts) | re-iterate; record the bounding algorithm |
| Before promising complete | all 4 corners populated + ≥ 1 ADR | refuse promise, continue |

## Acceptance Criteria

- [ ] All 5 research questions answered OR marked BLOCKED with reason
- [ ] Every citation resolves (reference + in-repo)
- [ ] Cross-cutting comparison populated (codex / opencode / in-repo fs-tools)
- [ ] Blueprint proposes `buildEnvContext` + `buildRepoMap` signatures + env-field set + budget/ignore/depth algorithm + never-throw contract, backed by codex + opencode + in-repo
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS (per `rules/discover-blueprint-golden-rule.md`)
- [ ] No fabricated citations
- [ ] All 4 coverage corners populated
- [ ] ADRs cover: signatures, env-field set, repo-map budget/ignore/depth, never-throw contract, node:fs-only zero-deps, placement
