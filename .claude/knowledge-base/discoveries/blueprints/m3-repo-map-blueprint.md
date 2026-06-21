# Blueprint: M3-3 — Repo-map / env-context builder

> Design source for `buildEnvContext(cwd)` + `buildRepoMap(cwd, {budget, ignore})` in `@theokit/sdk-tools` — node:fs-only, char-bounded, NEVER-THROW, to orient an LLM coding agent in one call. Backed by codex (`environment_context.rs` env struct + render, `agents_md.rs` project-doc discovery), opencode (`session/system.ts` `environment()` `<env>` block), and the in-repo sdk-tools fs primitives (read-file / list-dir / glob-files / truncation / path-guard). Discovery plan: `m3-repo-map` (discover-plan-confidence SHIPPABLE 99.7).

**Slug:** `m3-repo-map` · **Date:** 2026-06-20 · **Owner:** paulo

## Context

Greenfield (no repo-map/env-context anywhere in the SDK — confirmed). The SDK already ships the fs building blocks (`read-file.ts:51`, `list-dir.ts:43`, `glob-files.ts:33`, `truncation.ts:31`, `internal/path-guard.ts`) that return JSON and never throw on user mistakes — M3-3 follows THAT contract (never-throw), not the throw-on-violation contract of the M3-1/M3-2 guards. Two independent precedents define what an env/project-context block contains: codex's `EnvironmentContext` (struct + XML render) and opencode's `environment()` `<env>` block.

---

## Objective

Decide the `buildEnvContext(cwd)` and `buildRepoMap(cwd,{budget,ignore,maxDepth})` signatures, the env-context field set, the repo-map char-budget + ignore + depth strategy, and the NEVER-THROW contract — node:fs-only, zero new deps — so an LLM coding agent is oriented in one call. Backed by codex (`environment_context.rs`, `agents_md.rs`), opencode (`session/system.ts`), and the in-repo sdk-tools fs primitives.

## Coverage Corner 1 — Integration Tests

| Source | What it tests | Seeds these SDK RED tests |
|---|---|---|
| codex `agents_md_tests.rs` (`.claude/knowledge-base/reference/codex/codex-rs/core/src/agents_md_tests.rs`) | AGENTS.md discovery: walks up to project root, collects docs root→cwd, does NOT walk past root, bounded read | `buildEnvContext` surfaces a project-doc (AGENTS.md/README) when present; absent → omitted, no throw |
| codex `environment_context.rs` render (`environment_context.rs:144`) | env block renders cwd/shell/workspace deterministically | `buildEnvContext(cwd)` output contains cwd + platform + date + is-git deterministically |
| in-repo `truncation.ts:31-56` (existing tests) | byte-bounded output, strict `>` at-limit-not-truncated, never throws | `buildRepoMap` honors `budget` char cap; exactly-at-budget not over-truncated |

**SDK RED test set (for the plan):** env block contains cwd/platform/date/is-git; repo-map is bounded by `budget`; repo-map honors `ignore` (node_modules/.git/dist/.theo + dotdirs); **never throws** on a missing/unreadable cwd (returns best-effort partial / empty marker); AGENTS.md/README surfaced when present.

## Coverage Corner 2 — Dependencies

| Project | Builder deps | Portable to SDK? |
|---|---|---|
| codex | Rust std + internal `AbsolutePathBuf`/`Shell` | concept only |
| opencode | Effect runtime + plugin `Reference.Service` + `process.platform` | only `process.platform` + `new Date()` are portable; Effect/plugin machinery is NOT |
| in-repo fs-tools | `node:fs`, `node:path` only | YES — direct |

**Verdict:** `buildEnvContext`/`buildRepoMap` use **node:fs + node:path only — ZERO new deps** (KISS, Unbreakable Rule 9). No ripgrep, no Effect, no shell subprocess. `is-git` is derived from the presence of a `.git` entry (fs stat), not a `git` subprocess. Platform from `process.platform`; date from `new Date()`.

## Coverage Corner 3 — Tools

Module / export shape:

- codex: `EnvironmentContext` struct (`environment_context.rs:19-27`) with `environments`(cwd/shell), `current_date`, `timezone`, `filesystem`; `.render()` → XML string (`:144`). `agents_md.rs:34` `DEFAULT_AGENTS_MD_FILENAME = "AGENTS.md"`, `:36` `LOCAL_AGENTS_MD_FILENAME`, walks up to a project root marker.
- opencode: `environment()` (`system.ts:52`) returns string parts; the `<env>` block (`:67-72`) = Working directory, Workspace root, Is git repo, Platform, Today's date.
- in-repo: `truncateOutput(output,{maxBytes=30_000,outputDir})` (`truncation.ts:31`); `DEFAULT_EXCLUDES = {node_modules,.git,dist,.theo}` (`glob-files.ts:26`); `isForbiddenPath`/`safePathJoin` (`internal/path-guard.ts`).

**SDK module shape:** `packages/sdk-tools/src/internal/repo-map.ts`, barrel-exported, two pure-ish (fs-reading but side-effect-free) functions returning strings, never throwing:
```
buildEnvContext(cwd: string): string
  // → an <env> block: cwd, platform (process.platform), arch, node version,
  //   is-git (presence of .git), today's date, + project-doc heads (AGENTS.md / README.md first N chars) + detected manifests.
buildRepoMap(cwd: string, opts?: { budget?: number; ignore?: string[]; maxDepth?: number }): string
  // → a char-bounded directory tree (depth-first, dirs first), budget default 8_000 chars,
  //   maxDepth default 4, ignore default = DEFAULT_REPO_MAP_IGNORE (node_modules/.git/dist/.theo/.next/build/coverage + dotdirs),
  //   per-dir entry cap, "… (N more)" elision, never throws.
```
(No `createXTool` factory required for v1 — these are string builders an agent harness injects into the system prompt, mirroring opencode's `environment()`. A thin `createRepoMapTool` factory MAY wrap them later if a tool surface is wanted — out of v1 scope unless the plan adds it.)

## Coverage Corner 4 — Techniques

### Technique 1 — env-context field set (Q4)

Portable, fs-only-derivable fields (intersection of codex + opencode, minus sandbox/permission + plugin-references):

| Field | Source | Derivation (fs-only) |
|---|---|---|
| Working directory | opencode `<env>`, codex cwd | the `cwd` argument |
| Platform / arch | opencode `Platform`, | `process.platform` / `process.arch` |
| Node version | (SDK addition) | `process.version` |
| Is git repo | opencode `Is directory a git repo` | `existsSync(join(cwd,".git"))` — NO git subprocess |
| Today's date | opencode `Today's date` | `new Date().toDateString()` |
| Project docs | codex `agents_md.rs` | first ~N chars of `AGENTS.md` / `CLAUDE.md` / `README.md` if present (bounded, never-throw) |
| Detected manifests | (SDK addition; aligns with read-file precedent) | presence of `package.json`/`pyproject.toml`/`Cargo.toml`/`go.mod` |

Rendered as a single `<env>…</env>` block (opencode shape) — a plain string, no XML lib.

### Technique 2 — repo-map char-budget + ignore + depth + never-throw (Q5)

- **Char budget:** default `8_000` chars (smaller than truncation's 30_000 default — a repo map is one of several prompt blocks). Build depth-first, accumulate; when adding the next entry would exceed `budget`, stop and append a `… (truncated)` marker. Mirrors `truncation.ts` byte-bound philosophy (strict comparison; `truncation.ts:31`), but char-based and entry-aware (don't cut mid-line).
- **Ignore:** default set = `glob-files.ts` `DEFAULT_EXCLUDES` (`node_modules`,`.git`,`dist`,`.theo`) extended with `.next`,`build`,`coverage`,`target`,`out` + any dotdir; caller-supplied `ignore` is merged (union). Honors `isForbiddenPath` for sensitive files.
- **Max depth:** default `4` (codex `glob_scan_max_depth` precedent for bounding tree scans); per-dir entry cap (e.g. 200) with `… (N more)` elision.
- **Never-throw (EC-1, the load-bearing contract):** every `readdirSync`/`statSync`/`readFileSync` is wrapped; an `ENOENT`/`EACCES`/symlink loop on the root → return `<repo_map>(unavailable: <reason>)</repo_map>`; on a sub-dir → skip that dir, continue. The function NEVER propagates an exception (distinct from M3-1/M3-2 guards). Same for `buildEnvContext` — a field that can't be read is omitted, never fatal.

## Cross-cutting Comparison

| Dimension | codex | opencode | SDK decision |
|---|---|---|---|
| Env block content | cwd, shell, date, tz, filesystem-perms | cwd, worktree, is-git, platform, date, refs | cwd, platform/arch, node, is-git, date, project-docs, manifests |
| Project-doc | AGENTS.md walk-up (`agents_md.rs`) | plugin references | AGENTS.md/CLAUDE.md/README head, bounded |
| Render | XML struct render | string `<env>` join | plain `<env>` string (no XML dep) |
| Bounding | `glob_scan_max_depth` | (n/a, refs are few) | char budget + maxDepth + per-dir cap |
| Deps | Rust std | Effect + plugins | node:fs/path only — zero new deps |
| Error model | Result | Effect | NEVER-THROW best-effort string |

---

## ADRs

### D1 — Two string builders, never-throw, fs-only
**Decision:** `buildEnvContext(cwd):string` + `buildRepoMap(cwd,{budget,ignore,maxDepth}):string`, pure-ish fs readers that NEVER throw (best-effort partial / `(unavailable)` marker on any fs error). node:fs + node:path only, zero new deps.
**Rationale:** mirrors opencode `environment()` (string parts) + the in-repo never-throw JSON-tool contract; the LLM needs orientation even when a dir is unreadable. Rule 9 / KISS.
**Alternatives considered:** throw-on-error (rejected — a guardrail/context builder feeding an LLM must degrade gracefully); a `createRepoMapTool` factory (deferred — v1 is string builders injected into the system prompt; factory is YAGNI until a tool surface is requested).

### D2 — env-context field set = portable intersection (no sandbox, no plugins)
**Decision:** cwd, platform/arch, node version, is-git (`.git` presence, no subprocess), date, project-doc heads (AGENTS.md/CLAUDE.md/README, bounded), detected manifests. Rendered as one `<env>` string block.
**Rationale:** intersection of codex + opencode fields that are fs-only-derivable; drops codex's permission/sandbox `<filesystem>` (EC-2) and opencode's Effect/plugin references (EC-3).
**Alternatives considered:** copy codex's full struct (rejected — sandbox out of scope); shell out to `git` (rejected — needs subprocess, breaks fs-only + never-throw).

### D3 — repo-map bounding: char budget + maxDepth + per-dir cap + merged ignore
**Decision:** default budget 8_000 chars, maxDepth 4, per-dir entry cap, default ignore = glob-files excludes + common build/dot dirs, merged with caller `ignore`. Depth-first; stop at budget with a truncation marker; elide over-cap dirs with `… (N more)`.
**Rationale:** a repo map is one prompt block among many → tighter than truncation's 30k; codex bounds tree scans via `glob_scan_max_depth`; glob-files already defines the ignore baseline.
**Alternatives considered:** unbounded tree (rejected — blows the context window); `.gitignore` parsing (rejected for v1 — YAGNI; hardcoded list, documented).

### D4 — Placement + barrel export
**Decision:** `packages/sdk-tools/src/internal/repo-map.ts`; export `buildEnvContext`, `buildRepoMap` (+ option types) from the sdk-tools barrel.
**Rationale:** sibling of the fs tools it composes; internal/ for the pure logic, barrel for reuse (consumers inject into the system prompt; M8-2 `@ProjectContext` will later drive it).
**Alternatives considered:** in `@theokit/sdk` core (rejected — it is a tooling concern, belongs with the fs tools in sdk-tools).

### D5 — never-throw is the hard contract (not a sandbox / not exhaustive)
**Decision:** the builders are best-effort orientation, NOT a security or completeness guarantee; they degrade to partial/empty on any fs error and bound output, but do not promise a complete tree.
**Rationale:** honesty — a char-bounded tree omits entries by design; a permission error skips a dir. Documented like the M3-2 guardrail honesty.
**Alternatives considered:** guarantee completeness (rejected — unbounded + can't survive EACCES).

### D6 — scope: no .gitignore, no factory tool, POSIX+win path-safe
**Decision:** v1 uses a hardcoded ignore list (no `.gitignore` parse), ships builders not a tool factory, and uses `node:path` for cross-platform path joins. `.gitignore` respect + a `createRepoMapTool` wrapper are explicitly deferred (M8-2 / later).
**Rationale:** YAGNI; the roadmap asks for the builders, fs-only, char-bounded.
**Alternatives considered:** ship `.gitignore` parsing now (rejected — deferred complexity, not in the M3-3 spec).

## Recommendations for the project

1. Implement `buildEnvContext(cwd)` + `buildRepoMap(cwd,{budget,ignore,maxDepth})` in `packages/sdk-tools/src/internal/repo-map.ts`, node:fs/path only, NEVER-THROW (best-effort partial / `(unavailable)` marker), and export both from the sdk-tools barrel (D1/D4).
2. env-context fields = the portable intersection (cwd, platform/arch, node, is-git via `.git` presence, date, project-doc heads, manifests) rendered as one `<env>` string — NOT codex's sandbox `<filesystem>` nor opencode's plugin references (D2; EC-2/EC-3).
3. Bound the repo map with char budget (default 8_000) + maxDepth (default 4) + per-dir entry cap + merged ignore (glob-files excludes + build/dot dirs); stop at budget with a truncation marker (D3).
4. TDD must include the never-throw cases: missing cwd, EACCES sub-dir, symlink loop → best-effort string, no exception (EC-1).
5. Defer `.gitignore` parsing and a `createRepoMapTool` factory to a later milestone (D6 / M8-2 `@ProjectContext`).

## Blocked questions (if any)

- (none) — `.gitignore` respect and a tool-factory wrapper are deferred by D6; M8-2 (`@ProjectContext`) will later drive these builders.
