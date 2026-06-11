# Plan: TheoCode Phase 1 — Core Coding Tools

> **Version 1.1** — Ships 7 new tool factories in `@theokit/sdk-tools` to enable a coding agent to read, write, edit, search, and execute code. Phase 1 of the TheoCode roadmap. Informed by the OpenCode blueprint analysis of 20 tools at `knowledge-base/reference/opencode/packages/opencode/src/tool/`.

## Goal

> "Ship 7 coding tool factories (`createWriteFileTool`, `createEditFileTool`, `createGlobTool`, `createShellTool`, `createApplyPatchTool`, `createWebFetchTool`, `createWebSearchTool`) in `@theokit/sdk-tools` so that a TheoKit-powered coding agent can perform all core file operations, measured by `pnpm --filter @theokit/sdk-tools exec vitest run` exit 0 with 45+ new tests and all 7 tool factories exported from the barrel."

## Context

The OpenCode blueprint (2026-06-11) identified 20 tools in OpenCode's `tool/` directory. TheoKit SDK-tools currently ships 5 tools (read-file, list-dir, search-text, git-diff, run-vitest). The 7 most critical missing tools for a coding agent are: write, edit, glob, shell, apply-patch, webfetch, websearch. Without write+edit, an agent literally cannot modify code.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk-tools/src/index.ts` | 34 | `d7ba1c4` (2026-06-10) | Barrel export (5 tools) | Add 7 new exports |
| `packages/sdk-tools/src/path-scope.ts` | 28 | `d7ba1c4` (2026-06-10) | Shared path security (safePathJoin + symlink escape) | Reuse for write/edit/glob |
| `packages/sdk-tools/src/subprocess.ts` | 76 | `d7ba1c4` (2026-06-10) | Shared subprocess utilities | Reuse for shell tool |
| `packages/sdk-tools/src/read-file.ts` | 141 | `d7ba1c4` (2026-06-10) | Read tool (pattern reference for new tools) | Keep API shape |
| `packages/sdk-tools/src/write-file.ts` (NEW) | 0 | — | Write tool | — |
| `packages/sdk-tools/src/edit-file.ts` (NEW) | 0 | — | Edit tool (string replacement) | — |
| `packages/sdk-tools/src/glob-files.ts` (NEW) | 0 | — | Glob tool | — |
| `packages/sdk-tools/src/shell-exec.ts` (NEW) | 0 | — | Shell execution tool | — |
| `packages/sdk-tools/src/apply-patch.ts` (NEW) | 0 | — | Unified diff patch tool | — |
| `packages/sdk-tools/src/web-fetch.ts` (NEW) | 0 | — | URL fetch tool | — |
| `packages/sdk-tools/src/web-search.ts` (NEW) | 0 | — | Web search tool | — |
| `packages/sdk-tools/tests/write-file.test.ts` (NEW) | 0 | — | — | — |
| `packages/sdk-tools/tests/edit-file.test.ts` (NEW) | 0 | — | — | — |
| `packages/sdk-tools/tests/glob-files.test.ts` (NEW) | 0 | — | — | — |
| `packages/sdk-tools/tests/shell-exec.test.ts` (NEW) | 0 | — | — | — |
| `packages/sdk-tools/tests/apply-patch.test.ts` (NEW) | 0 | — | — | — |
| `packages/sdk-tools/tests/web-fetch.test.ts` (NEW) | 0 | — | — | — |
| `packages/sdk-tools/tests/web-search.test.ts` (NEW) | 0 | — | — | — |

### Current callers / dependents

- **`createReadFileTool`** — pattern reference for all new tools. Factory function returning `CustomTool`.
- **`pathScopeCheck`** (`path-scope.ts`) — shared by all 5 existing tools. All 7 new tools reuse it for path security.
- **`subprocess.ts`** — shared by `git-diff` and `run-vitest`. Shell tool reuses it.
- **Barrel** (`index.ts`) — adding 7 exports. No breaking changes.

### Domain glossary

- **Tool factory** — `createXxxTool(opts: { projectRoot: string }): CustomTool` — function that returns a `CustomTool` object (name, description, inputSchema, handler)
- **Path scope** — security boundary: all file ops confined to `projectRoot`, symlink escape blocked
- **Fuzzy edit** — OpenCode's edit tool uses 9 replacer strategies for inexact string matching; TheoCode v1 uses exact + whitespace-normalized (2 strategies, per KISS)

### Architecture boundaries affected

- **`@theokit/sdk-tools`** — all 7 tools are new files in the existing package. No new packages needed.
- **DIP (`architecture.md`)** — tools depend on `path-scope.ts` (shared) and `subprocess.ts` (shared), not on SDK internals.

## Prior Art & Related Work

- **OpenCode blueprint** — `knowledge-base/discoveries/blueprints/opencode-clone-theokit-blueprint.md` Q2 (20-tool matrix). Each tool's input schema, security, and truncation documented with file:line citations.
- **Existing `createReadFileTool`** — `packages/sdk-tools/src/read-file.ts:1` — the pattern all new tools follow (Zod inputSchema, `{ ok, ... }` JSON return, path security via pathScopeCheck).

## Objective

- [ ] Verify `createWriteFileTool` writes files with path security + backup, confirmed by 7+ tests
- [ ] Verify `createEditFileTool` replaces strings in files with exact + whitespace-normalized matching, confirmed by 8+ tests
- [ ] Verify `createGlobTool` finds files by glob pattern within project scope, confirmed by 6+ tests
- [ ] Verify `createShellTool` executes commands via `LocalSandbox` with timeout + output cap, confirmed by 6+ tests
- [ ] Verify `createApplyPatchTool` applies unified diff patches, confirmed by 6+ tests
- [ ] Verify `createWebFetchTool` fetches URLs with timeout + size cap, confirmed by 5+ tests
- [ ] Verify `createWebSearchTool` delegates to a search provider callback, confirmed by 5+ tests
- [ ] Run `pnpm --filter @theokit/sdk-tools exec vitest run` exit 0 with 45+ new tests

## ADRs

### D1 — All 7 tools follow the existing `createXxxTool` factory pattern

**Decision:** Every new tool is a factory function `createXxxTool(opts): CustomTool` with Zod inputSchema, JSON-returning handler, and path security via `pathScopeCheck`. Identical pattern to `createReadFileTool`.

**Rationale:** Per DRY: one pattern, 12 tools. Per KISS: consumers learn one API shape. Per `architecture.md` SRP: each tool file has one responsibility.

**Alternatives considered:**
- **(A) Class-based tools** — rejected: the existing 5 tools are factories; mixing would break consistency.

**Consequences:** All tools importable from `@theokit/sdk-tools` barrel. Per Rule #9, `@Tool` decorator already exists in `di-agent`.

### D2 — Edit tool uses 2 replacer strategies (exact + whitespace-normalized), not OpenCode's 9

**Decision:** TheoCode Phase 1 ships exact match + whitespace-normalized match. OpenCode's 9-strategy chain (Simple, LineTrimmed, BlockAnchor, WhitespaceNormalized, IndentationFlexible, EscapeNormalized, TrimmedBoundary, ContextAware, MultiOccurrence) is deferred to Phase 3.

**Rationale:** Per YAGNI + KISS: 2 strategies handle 90% of LLM edit requests. The remaining 10% (indentation-flexible, context-aware) are optimizer — not blockers. OpenCode's `edit.ts` is 737 LoC; our v1 target is ≤150 LoC.

**Alternatives considered:**
- **(A) Port all 9 replacers immediately** — rejected: 737 LoC in one file violates 500 LoC budget. Ship iteratively.

**Consequences:** Edge cases where LLM provides slightly wrong indentation will fail in Phase 1. Users can fall back to `createWriteFileTool` for full-file overwrites.

### D3 — Shell tool delegates to LocalSandbox, not raw subprocess

**Decision:** `createShellTool` wraps `LocalSandbox.execute()` from `@theokit/sdk/sandbox`. NOT a raw `child_process.exec`.

**Rationale:** Per DIP: reuse the sandbox abstraction. `LocalSandbox` already handles timeout, output truncation, and the `ExecuteResult` type. Per the DeepAgents parity plan: sandbox backend exists specifically for this.

**Alternatives considered:**
- **(A) Raw subprocess** — rejected: duplicates timeout/truncation logic already in `LocalSandbox`.

**Consequences:** Shell tool requires `@theokit/sdk` as peer dep (already the case for sdk-tools).

### D4 — WebSearch tool accepts a provider callback, not a hardcoded API

**Decision:** `createWebSearchTool(opts: { search: (query: string) => Promise<SearchResult[]> })` — the search implementation is injected by the consumer, not hardcoded.

**Rationale:** Per DIP: the tool defines the contract; the consumer wires the provider (Exa, Tavily, Brave, or MCP). Per YAGNI: we don't need to ship 4 search providers now.

**Alternatives considered:**
- **(A) Built-in Exa/Tavily clients** — rejected: adds external API deps to sdk-tools; per Rule 9 "don't reinvent" but also "don't over-couple".

**Consequences:** Consumer must provide the search callback. SDK ships the tool shape; consumer wires the provider.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Edit tool with only 2 strategies will fail on indentation-mismatched edits | Medium | Fall back to write-file for full overwrite; Phase 3 adds more strategies | D2 |
| Shell tool inherits LocalSandbox limitations (no Docker isolation in v1) | Low | Document that LocalSandbox is NOT a security boundary | D3 |
| WebSearch tool requires consumer to provide search callback | Low | Document in README; provide example with Exa API | D4 |

## Unresolved Questions

(none — every decision resolved. Tool patterns proven by 5 existing tools. OpenCode reference analyzed in blueprint Q2.)

## Dependency Graph

```
Phase 1a (write + edit) ──▶ Phase 1b (glob + shell + patch) ──▶ Phase 1c (webfetch + websearch) ──▶ Phase 2 (validation)
```

Phase 1a first because write+edit are the most critical for a coding agent. Phases 1b and 1c can run in parallel after 1a.

---

## Phase 1a: Write + Edit Tools

**Objective:** Ship the 2 most critical file mutation tools.

### T1.1 — createWriteFileTool

#### Objective
Create a tool that writes/creates files within the project scope with path security.

#### Why this step
1. **What:** Create `write-file.ts` with `createWriteFileTool(opts)` factory. Input: `{ path, content }`. Output: `{ ok, bytesWritten }` or `{ ok: false, error }`. Security: pathScopeCheck + backup (.bak) before overwrite.
2. **Why now:** A coding agent that can't write files is useless. This is THE foundational tool. Per blueprint Q2: OpenCode's `write.ts` (104 LoC) is straightforward.

#### Evidence
- OpenCode `tool/write.ts:1-104` — simple write with permission check + directory creation
- Existing `createReadFileTool` at `read-file.ts:1` — pattern to follow

#### Files to edit
```
packages/sdk-tools/src/write-file.ts (NEW) — createWriteFileTool factory
packages/sdk-tools/src/index.ts — add export
packages/sdk-tools/tests/write-file.test.ts (NEW) — tests
```

#### Deep file dependency analysis
- `write-file.ts`: new file. Imports `pathScopeCheck` from `path-scope.ts`. Uses `fs.writeFile` + `fs.mkdir` (recursive).
- `index.ts`: adding 1 export line. No existing exports affected.

#### Tasks
1. Create `write-file.ts` with factory function
2. Add export to `index.ts`
3. Write tests

#### TDD
```
RED:     test_write_creates_new_file() — write to new path → file exists with correct content
RED:     test_write_overwrites_existing() — overwrite → content replaced
RED:     test_write_creates_directories() — write to nested path → dirs created recursively
RED:     test_write_rejects_path_traversal() — "../outside" → { ok: false, error: "path_traversal" }
RED:     test_write_rejects_sensitive_paths() — ".env" → { ok: false, error: "forbidden_path" }
RED:     test_write_returns_bytes_written() — verify bytesWritten in result
RED:     test_write_empty_content() — empty string → file created with 0 bytes
RED:     test_write_rejects_binary_overwrite() — (EC-1) writing text over binary file (null bytes in first 8KB) → { ok: false, error: "binary_file" }
GREEN:   Implement createWriteFileTool (includes binary file probe)
REFACTOR: Extract shared constants (sensitive patterns) if duplicated with read-file
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/write-file.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/sdk-tools exec vitest run tests/write-file.test.ts` and confirm exit 0 with 7+ tests passing
- [ ] Verify path traversal blocked via `pathScopeCheck`
- [ ] Run `pnpm --filter @theokit/sdk-tools exec tsc --noEmit` and confirm exit 0

#### DoD
- [ ] Run tests and confirm 7+ pass
- [ ] Run typecheck and confirm exit 0

---

### T1.2 — createEditFileTool

#### Objective
Create a tool that replaces strings in files using exact + whitespace-normalized matching.

#### Why this step
1. **What:** Create `edit-file.ts` with `createEditFileTool(opts)` factory. Input: `{ path, old_string, new_string }`. Output: `{ ok, replacements }` or `{ ok: false, error }`. Two strategies: exact match first, then whitespace-normalized fallback.
2. **Why now:** Per ADR D2: v1 ships 2 strategies (90% coverage). OpenCode's `edit.ts` is 737 LoC with 9 replacers — our v1 is ~150 LoC.

#### Evidence
- OpenCode `tool/edit.ts:244-728` — 9-strategy replacer chain
- Blueprint Q2: edit tool is the most complex tool in OpenCode

#### Files to edit
```
packages/sdk-tools/src/edit-file.ts (NEW) — createEditFileTool factory
packages/sdk-tools/tests/edit-file.test.ts (NEW) — tests
```

#### Tasks
1. Create `edit-file.ts` with 2-strategy replacement
2. Write tests

#### TDD
```
RED:     test_edit_exact_match() — exact old_string found and replaced
RED:     test_edit_whitespace_normalized() — old_string with extra spaces matches file content
RED:     test_edit_no_match_returns_error() — old_string not found → { ok: false, error: "no_match" }
RED:     test_edit_multiple_occurrences_replaces_first() — 2 matches → only first replaced
RED:     test_edit_rejects_path_traversal() — "../outside" → error
RED:     test_edit_preserves_file_encoding() — utf-8 content preserved
RED:     test_edit_empty_old_string_rejected() — empty old_string → error
RED:     test_edit_creates_backup() — .bak file created before edit (EC-2: single .bak per file, overwrite each time)
RED:     test_edit_backup_overwrites_previous() — (EC-2) second edit on same file → .bak contains content from before SECOND edit, not first
GREEN:   Implement createEditFileTool (backup: single .bak overwrite per file)
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/edit-file.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/sdk-tools exec vitest run tests/edit-file.test.ts` and confirm exit 0 with 8+ tests passing
- [ ] Run `pnpm --filter @theokit/sdk-tools exec vitest run tests/edit-file.test.ts` and confirm whitespace-normalized test passes (tabs vs spaces match)
- [ ] Run `pnpm --filter @theokit/sdk-tools exec tsc --noEmit` and confirm exit 0

#### DoD
- [ ] Run tests and confirm 8+ pass
- [ ] Run typecheck and confirm exit 0

---

## Phase 1b: Glob + Shell + Patch

**Objective:** Ship file discovery + command execution + patch application tools.

### T1.3 — createGlobTool

#### Files to edit
```
packages/sdk-tools/src/glob-files.ts (NEW)
packages/sdk-tools/tests/glob-files.test.ts (NEW)
```

#### TDD
```
RED:     test_glob_finds_ts_files() — "**/*.ts" → returns matching paths
RED:     test_glob_respects_project_root() — results scoped to projectRoot
RED:     test_glob_returns_empty_for_no_match() — "**/*.xyz" → []
RED:     test_glob_ignores_node_modules() — node_modules excluded by default
RED:     test_glob_returns_relative_paths() — paths relative to projectRoot
RED:     test_glob_rejects_path_traversal() — "../**" → error
RED:     test_glob_ignores_symlink_loops() — (EC-5) symlink loop in dir → glob completes without hang
GREEN:   Implement createGlobTool
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/glob-files.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/sdk-tools exec vitest run tests/glob-files.test.ts` and confirm exit 0 with 6+ tests passing

---

### T1.4 — createShellTool

#### Files to edit
```
packages/sdk-tools/src/shell-exec.ts (NEW)
packages/sdk-tools/tests/shell-exec.test.ts (NEW)
```

#### TDD
```
RED:     test_shell_executes_command() — "echo hello" → { ok, stdout: "hello\n" }
RED:     test_shell_captures_stderr() — command with stderr → stderr populated
RED:     test_shell_timeout() — long command with short timeout → timedOut: true
RED:     test_shell_exit_code() — "exit 42" → exitCode: 42
RED:     test_shell_truncates_output() — large output → truncated
RED:     test_shell_uses_project_root_as_cwd() — commands run in projectRoot
GREEN:   Implement createShellTool (delegates to LocalSandbox per ADR D3)
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/shell-exec.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/sdk-tools exec vitest run tests/shell-exec.test.ts` and confirm exit 0 with 6+ tests passing

---

### T1.5 — createApplyPatchTool

#### Files to edit
```
packages/sdk-tools/src/apply-patch.ts (NEW)
packages/sdk-tools/tests/apply-patch.test.ts (NEW)
```

#### TDD
```
RED:     test_patch_applies_unified_diff() — valid unified diff → file modified correctly
RED:     test_patch_rejects_malformed_diff() — invalid diff → { ok: false, error: "invalid_patch" }
RED:     test_patch_rejects_path_traversal() — diff targeting "../outside" → error
RED:     test_patch_creates_backup() — .bak before applying
RED:     test_patch_handles_new_file() — diff creating new file → file created
RED:     test_patch_handles_delete_file() — diff deleting file → file removed
RED:     test_patch_handles_crlf() — (EC-4) target file with \r\n + diff with \n → patch applied correctly
GREEN:   Implement createApplyPatchTool
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/apply-patch.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/sdk-tools exec vitest run tests/apply-patch.test.ts` and confirm exit 0 with 6+ tests passing

---

## Phase 1c: Web Tools

**Objective:** Ship URL fetch + web search tools.

### T1.6 — createWebFetchTool

#### Files to edit
```
packages/sdk-tools/src/web-fetch.ts (NEW)
packages/sdk-tools/tests/web-fetch.test.ts (NEW)
```

#### TDD
```
RED:     test_fetch_returns_text_content() — valid URL → { ok, content, statusCode }
RED:     test_fetch_respects_timeout() — slow server → timeout error
RED:     test_fetch_respects_size_cap() — large response → truncated
RED:     test_fetch_rejects_non_http_urls() — "file:///etc/passwd" → error
RED:     test_fetch_returns_status_code() — 404 → { ok: false, statusCode: 404 }
RED:     test_fetch_follows_redirects() — (EC-3) 301 redirect → follows and returns final content
GREEN:   Implement createWebFetchTool (uses native fetch)
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/web-fetch.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/sdk-tools exec vitest run tests/web-fetch.test.ts` and confirm exit 0 with 5+ tests passing

---

### T1.7 — createWebSearchTool

#### Files to edit
```
packages/sdk-tools/src/web-search.ts (NEW)
packages/sdk-tools/tests/web-search.test.ts (NEW)
```

#### TDD
```
RED:     test_search_calls_provider_callback() — mock provider called with query
RED:     test_search_returns_results() — provider returns results → tool returns them
RED:     test_search_handles_provider_error() — provider throws → { ok: false, error }
RED:     test_search_limits_results() — maxResults=5 → max 5 returned
RED:     test_search_empty_query_rejected() — "" → error
GREEN:   Implement createWebSearchTool (per ADR D4: provider callback injection)
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/web-search.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/sdk-tools exec vitest run tests/web-search.test.ts` and confirm exit 0 with 5+ tests passing

---

## Phase 2: Integration Validation (MANDATORY)

**Objective:** Validate all 7 tools work together + existing tests pass.

### Execution

```bash
pnpm --filter @theokit/sdk-tools exec vitest run    # all sdk-tools tests
pnpm --filter @theokit/sdk-tools exec tsc --noEmit   # typecheck
pnpm --filter @theokit/sdk-tools run build            # DTS build
pnpm -w run check                                     # biome lint
```

### Acceptance Criteria

- [ ] Run `pnpm --filter @theokit/sdk-tools exec vitest run` and confirm all tests pass (existing 7 + 45+ new)
- [ ] Run `pnpm --filter @theokit/sdk-tools exec tsc --noEmit` and confirm exit 0
- [ ] Run `pnpm --filter @theokit/sdk-tools run build` and confirm DTS emit succeeds
- [ ] Run `pnpm -w run check` and confirm zero lint errors
- [ ] Verify all 7 new factories exported from `@theokit/sdk-tools` barrel
- [ ] Verify CHANGELOG updated with 7 entries under `[Unreleased] § Added`

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Write file tool | T1.1 | `createWriteFileTool` with path security + mkdir recursive |
| 2 | Edit file tool (2 strategies) | T1.2 | `createEditFileTool` with exact + whitespace-normalized |
| 3 | Glob file tool | T1.3 | `createGlobTool` with node_modules exclusion |
| 4 | Shell execution tool | T1.4 | `createShellTool` via `LocalSandbox` (ADR D3) |
| 5 | Apply patch tool | T1.5 | `createApplyPatchTool` with unified diff parsing |
| 6 | Web fetch tool | T1.6 | `createWebFetchTool` with timeout + size cap |
| 7 | Web search tool | T1.7 | `createWebSearchTool` with provider callback (ADR D4) |
| 8 | 45+ new tests | T1.1-T1.7 | 8+9+7+6+7+6+5 = 48 minimum + integration |
| 9 | Barrel export all 12 tools | T1.1-T1.7 | `index.ts` updated with 7 new exports |
| 10 | TheoCode roadmap Phase 1 complete | T1.1, T1.2, T1.3, T1.4, T1.5, T1.6, T1.7 | All 7 tools shipped + validation gates pass |
| 11 | EC-1: Binary file guard on write | T1.1 | Probe first 8KB for null bytes before overwrite |
| 12 | EC-2: Backup strategy (single .bak) | T1.2 | Single .bak per file, overwrite each time |
| 13 | EC-3: WebFetch redirect handling | T1.6 | Test 301 redirect following |
| 14 | EC-4: CRLF line endings in patches | T1.5 | Test \r\n target + \n diff |
| 15 | EC-5: Glob symlink loop safety | T1.3 | Test completes without hang |
| 16 | EC-6: Shell non-UTF-8 output | T1.4 | Documented: garbled output accepted for v1 |

**Coverage: 16/16 gaps covered (100%)**

## Global Definition of Done

- [ ] Verify all phases completed
- [ ] Run `pnpm --filter @theokit/sdk-tools exec vitest run` and confirm all tests passing
- [ ] Run `pnpm --filter @theokit/sdk-tools exec tsc --noEmit` and confirm zero type errors
- [ ] Run `pnpm -w run check` and confirm zero lint warnings
- [ ] Verify file-size budget respected (all files ≤ 500 LoC per `architecture.md`; edit-file.ts ≤ 150 LoC per ADR D2)
- [ ] Verify CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Verify 45+ new tests added across 7 test files
- [ ] Confirm plan archived to `knowledge-base/plans/completed/` after merge

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Full validation chain.

### Execution

```bash
pnpm --filter @theokit/sdk-tools exec vitest run
pnpm --filter @theokit/sdk-tools exec tsc --noEmit
pnpm --filter @theokit/sdk-tools run build
pnpm -w run check
```

### Acceptance Criteria

- [ ] Run `pnpm --filter @theokit/sdk-tools exec vitest run` and confirm exit 0 with all tests passing
- [ ] Run `pnpm --filter @theokit/sdk-tools exec tsc --noEmit` and confirm exit 0 with zero type errors
- [ ] Run `pnpm --filter @theokit/sdk-tools run build` and confirm exit 0 with `dist/index.d.ts` emitted
- [ ] Run `pnpm -w run check` and confirm exit 0 with zero lint errors
