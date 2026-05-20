# Plan: Context Files Coverage — AGENTS.md / CLAUDE.md / GEMINI.md / .cursor/rules / THEO.md

> **Version 1.2 — ✅ COMPLETED 2026-05-20** — TODAS AS TASKS, CRITÉRIOS DE ACEITE, DODs CONCLUÍDAS E VALIDADAS. Dogfood telegram-pro 34/36 PASS + 1 SKIP (Honcho envGate) + 1 FAIL (`/recall` pre-existing OpenRouter rate-limit flake, NÃO relacionado a context-files). `/context` ✅ PASS 1.06s. 1132/1132 SDK tests PASS (1062 baseline + 70 new across 7 test files). 10 ADRs (D150-D159) escritos. CLAUDE.md SDK Roadmap row #4 → ✅ DONE. EC-A/B/C/D/E (MUST FIX) todos aplicados; EC-F/G/H/I/J/K/L/M (SHOULD TEST) validados via tests; EC-N/O/P/Q/R/S/T (DOCUMENT) inline em ADRs/JSDoc.
>
> **Version 1.1** (2026-05-20) — incorporates edge-case review: 5 MUST FIX (EC-A drop `.gitignore` complexity, EC-B drop invented `.theokitignore`, EC-C truncation marker guard, EC-D imports inherit per-file cap, EC-E disambiguation uses relative-to-git-root paths to avoid absolute-path privacy leak) + 8 SHOULD TEST woven into TDD blocks + 7 DOCUMENT items added to ADRs/JSDoc.
>
> **Version 1.0** (2026-05-20) — extends `FileContextManager` from loading only `.theokit/context/*.md` (Zod frontmatter) to auto-discovering the 2026 industry-standard context files: `AGENTS.md` (60k+ repos, Linux Foundation 2025), `CLAUDE.md` (Anthropic), `GEMINI.md` (Google), `.cursor/rules/*.mdc` (Cursor IDE), and a new SDK-specific `.theokit/THEO.md` for Theo-only overrides. Closes SDK Roadmap row #4 (Hermes #4, score 6). Backward compatible — existing `.theokit/context/*.md` sources continue to work unchanged.

## Context

### What exists today

- `FileContextManager` (`packages/sdk/src/internal/runtime/context-manager.ts:262 LoC`) loads ONLY `.theokit/context/*.md` with Zod-validated frontmatter (`name`, `path`, `enabled`, `maxTokens`) per ADRs D10/D76.
- Falls back to deprecated `.theokit/context.json` with one-time stderr warning.
- Discovery is **flat** (single directory, no recursion, no walk-to-git-root).
- Public snapshot via `agent.context.snapshot()`; surfaces in system prompt as `<context><source name="...">...</source></context>` block via `ContextPromptProvider`.
- `examples/telegram-pro/.theokit/context/bot-readme.md` is the canonical pattern in use today.

### What's broken or missing

The roadmap claim "FileContextManager hoje lê CLAUDE.md / AGENTS.md" is **factually wrong** — neither is loaded. The actual gap is much wider:

1. **No AGENTS.md support** — the de facto 2026 standard, **60k+ repos, 22-28% of OSS projects** (arXiv Feb 2026, 128k-project study), supported natively by Codex, Cursor, Copilot, Claude Code (fallback), Gemini CLI, Aider, Zed, Warp, Windsurf. The single biggest interop gap.
2. **No CLAUDE.md support** — Anthropic's house format, walk-up + lazy-nested + `@import` syntax. High overlap with our user base.
3. **No GEMINI.md support** — Google Gemini CLI. Same shape as CLAUDE.md.
4. **No `.cursor/rules/*.mdc` support** — Cursor's current format (MDC = Markdown + YAML frontmatter with `globs`/`description`/`alwaysApply`). The legacy `.cursorrules` is **silently ignored** by Cursor itself in Agent mode.
5. **No SDK-specific override file** — users can't write Theo-specific instructions (memory adapter hints, MCP scopes, telemetry preferences) without polluting AGENTS.md that other agents also read.
6. **No git-root walk** — Hermes/Gemini-CLI both walk from cwd upward; we only look at flat cwd.
7. **No `@import` resolution** — CLAUDE.md and GEMINI.md both support `@path/to/file` with 5-hop limit.

### Evidence motivating NOW (not later)

- **SDK Roadmap row #4 (score 6)** in `CLAUDE.md`. Listed as "Loader extension trivial" but my deep research (2026-05-20, parallel codebase + ecosystem audit) showed it's **2-3 days** of focused work, not trivial. Still high-leverage at score 6.
- **Empirical efficiency win:** arXiv paper (2601.20404v2, 124 PRs across 10 repos) measured **16.58% lower median runtime** when AGENTS.md is present and consulted by the agent. Our SDK currently leaves this win on the table.
- **Customer overlap:** every Theo user who also uses Cursor, Codex, Claude Code, or Copilot has at least one of these files in their repo. Ignoring them creates a "Theo doesn't see what other agents see" friction.
- **Interop pressure:** Linux Foundation took AGENTS.md governance in Dec 2025. Standing outside the standard isolates us.

## Objective

**Done = a developer with `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc`, or `.theokit/THEO.md` in their repo gets that content auto-injected into every `agent.send()` call's system prompt, walking from cwd up to git-root, capped at 40k chars per file and 120k chars total, with `@import` resolution for CLAUDE/GEMINI imports.**

Measurable goals:

1. Discover + load `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` from cwd → git-root (walk-up).
2. Discover + load `.cursor/rules/*.mdc` with frontmatter parsing (globs honored for the current turn's touched files; otherwise `alwaysApply: true` only).
3. Discover + load `.theokit/THEO.md` (SDK-specific, last-writer-wins).
4. Implement `@import` resolution (5-hop max, cycle detection) for CLAUDE/GEMINI.
5. Size cap: 40k chars per file, 120k chars total aggregate, with 70%/20% head/tail truncation + marker.
6. Backward compat: existing `.theokit/context/*.md` sources keep working unchanged.
7. 10 new ADRs (D150-D159).
8. CHANGELOG entry + CLAUDE.md SDK Roadmap row #4 → ✅ DONE.
9. Dogfood `/context` command in telegram-pro showing discovered files.
10. Zero regression: 1062 baseline SDK tests stay green.

## ADRs

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| **D150** | Auto-discover **AGENTS.md + CLAUDE.md + GEMINI.md + .cursor/rules/*.mdc + .theokit/THEO.md**. **Skip** SOUL.md, .hermes.md, .cursorrules (legacy), JULES.md, CONVENTIONS.md. | AGENTS.md is the 2026 anchor (60k+ repos, LF-stewarded). CLAUDE.md + GEMINI.md cover major vendor users. `.cursor/rules/*.mdc` is the current Cursor format (legacy `.cursorrules` silently ignored by Cursor itself in Agent mode). SOUL.md is wrong axis (identity ≠ project context). `.hermes.md` has zero adoption beyond Hermes. | **Enables:** interop with 2026 standard. **Constrains:** SOUL.md users (Hermes-specific) must manually configure; documented as non-goal. |
| **D151** | Discovery is **walk-up from cwd to git-root** — pure `existsSync` checks, no gitignore parsing (EC-A) and no invented `.theokitignore` (EC-B). Nearest file per directory wins for `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`. Git worktrees work because `.git` exists as a file even there (EC-N). Expected overhead <50ms for 20-level deep cwd × 6 specs = 120 stat calls (EC-O). | Hermes/Gemini-CLI/Claude-Code all walk upward — established mental model. `.git/` is the canonical project boundary. **Drop gitignore respect:** context files (AGENTS.md, CLAUDE.md, etc.) are virtually always tracked; parsing `.gitignore` adds ~100 LoC + negation/ordering edge cases for ~0% real-world benefit. KISS. **Drop `.theokitignore`:** zero precedent in the ecosystem; brand pollution. Add later if signal emerges. | **Enables:** monorepo support (nested `AGENTS.md` per service); simple implementation. **Constrains:** non-git workspaces use cwd-only fallback. Users who explicitly want a file ignored simply place it in a non-walked location. |
| **D152** | Merge strategy = **`concat-by-priority`**, NOT first-match-wins. Order (ascending = early in prompt, last-writer-wins on conflict): `AGENTS.md` (10) → `GEMINI.md` (20) → `CLAUDE.md` (30) → `.cursor/rules/*.mdc` (40) → `.theokit/context/*.md` (50) → `.theokit/THEO.md` (60). | Hermes's first-match wins **discards signal**. Real users have AGENTS.md (shared) + CLAUDE.md (Claude-specific) coexisting precisely because each is for a different reader. Last-writer-wins lets `.theokit/THEO.md` override anything else for Theo-specific tweaks. | **Enables:** layered overrides; same repo works for multiple agents. **Constrains:** total token cost is sum-of-files, not min-of-files. Cap at 120k mitigates. |
| **D153** | New SDK-specific file lives at **`.theokit/THEO.md`**, NOT repo root. | Root pollution is a real complaint (Cursor's `.cursorrules` deprecation was partly motivated by this). `.theokit/` is already the canonical SDK config dir (`.theokit/mcp.json`, `.theokit/plugins/`, `.theokit/context/`, `.theokit/skills/`). Putting THEO.md inside it costs zero visual budget. | **Enables:** Theo-specific overrides without root pollution. **Constrains:** users who want root-level discovery must symlink — documented. |
| **D154** | **Plain markdown** for `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / `THEO.md`. **MDC frontmatter** parsed only for `.cursor/rules/*.mdc`. Existing `.theokit/context/*.md` keeps its Zod frontmatter (D10/D76). | "Radical simplicity" is part of why AGENTS.md won — frontmatter is non-portable for these. MDC's `globs`/`description`/`alwaysApply` is the ONLY value MDC adds over plain markdown, so we parse it where it lives. | **Enables:** copy-paste portability across agents. **Constrains:** per-source tuning (e.g. per-AGENTS.md size cap) requires SDK config, not in-file metadata. |
| **D155** | Per-file cap: **40_000 chars** (~10k tokens). Total aggregate cap: **120_000 chars**. Truncation: 70% head + 20% tail + `…[truncated by theokit]` marker. | 2× Hermes's 20k per-file is reasonable for 2026 context windows (Claude Sonnet 4 = 1M, Gemini 2.5 = 2M tokens). 120k total stays well under any prompt-cache breakpoint. 70/20 head/tail mirrors Hermes — heads carry anchor sections (project name, conventions), tails preserve "## Don't do this" closers. | **Enables:** predictable token budget; works across all model sizes. **Constrains:** users with >40k char files lose middle content. Configurable via `AgentOptions.context`. |
| **D156** | Support **`@path/to/file`** import syntax (Anthropic/Gemini convention), **5-hop max** with cycle detection. Applies to `CLAUDE.md` + `GEMINI.md` only. | Both vendors use this exact syntax; we'd be confusingly partial if we skipped it. 5-hop cap matches Anthropic's documented limit. Cycle detection prevents infinite loop on `A.md @import B.md` ↔ `B.md @import A.md`. Skipped for AGENTS.md/THEO.md because neither has a documented import convention. | **Enables:** `@~/.theokit/global-instructions.md` + `@./packages/api/CONVENTIONS.md` composition. **Constrains:** parser complexity — but bounded by 5 hops. |
| **D157** | **Lazy-nested CLAUDE.md** (load nested `CLAUDE.md` from a subdir when the agent touches files there) **deferred to v2**. | High implementation cost (needs a hook on the file-read pipeline + invalidation logic). Low initial-iteration value: 95% of teams have a single root `CLAUDE.md`. Anthropic itself recommends keeping CLAUDE.md tiny (<200 lines) which de-incentivizes deep nesting. Re-evaluate after telemetry shows nested files in the wild. | **Enables:** ship v1 in 2-3 days. **Constrains:** monorepos with per-service CLAUDE.md only get the nearest one in the cwd-to-root walk, not the dynamic per-task one. |
| **D158** | **Backward compat:** existing `.theokit/context/*.md` Zod-frontmatter sources keep working unchanged. They become ONE entry in the merge ladder (priority 50). | We have at least one example (`telegram-pro/.theokit/context/bot-readme.md`) and likely third-party users. Breaking them would be a SemVer major. The frontmatter pattern is still useful for power users (per-source `enabled: false`, `maxTokens` override). | **Enables:** zero migration friction; users can adopt new format incrementally. **Constrains:** two parallel code paths in the loader — but cleanly separated. |
| **D159** | Telemetry emits **`context_files_truncated`** counter when any cap fires. Per-file truncations emit one counter increment per file, total-cap truncations emit `context_files_total_truncated`. Honors `AgentOptions.telemetry` opt-in. | Hidden truncation is a debugging nightmare — users see "agent doesn't know about my docs" without knowing the docs got cut. Telemetry surfaces this without spamming logs. Aligns with our existing telemetry-by-default-off posture (D34). | **Enables:** users can audit truncation rate without manual logging. **Constrains:** one new counter name — documented in telemetry guide. |

## Edge Case Integration (v1.1)

Edge-case review (2026-05-20) surfaced 20 items. Integration summary:

| EC | Severity | Where | Type of fix |
|---|---|---|---|
| EC-A | MUST FIX | T1.1 / D151 | Plan: drop `.gitignore` parsing (KISS) |
| EC-B | MUST FIX | T1.1 / D151 | Plan: drop invented `.theokitignore` (scope creep) |
| EC-C | MUST FIX | T1.2 | Code: guard `if (max <= MARKER.length)` in `truncateWithMarker` |
| EC-D | MUST FIX | T2.1 | Code: imports inherit `maxBytesPerFile` cap per-file |
| EC-E | MUST FIX | T5.1 | Code: disambiguation uses relative-to-git-root, never absolute (privacy) |
| EC-F | SHOULD TEST | T1.1 | Test: realpath dedup for symlink chains |
| EC-G | SHOULD TEST | T1.2 | Test: missing-file ENOENT returns undefined, no throw |
| EC-H | SHOULD TEST | T1.2 | Test: truncation keeps valid UTF-8 codepoints |
| EC-I | SHOULD TEST | T3.1 | Test: empty touchedFiles → only `alwaysApply: true` activates |
| EC-J | SHOULD TEST | T4.1 | Code+Test: same-priority tie-break by path lex (prompt-cache stability) |
| EC-K | SHOULD TEST | T6.1 | Test: legacy JSON config CONTENT loads, not just warning |
| EC-L | SHOULD TEST | T1.2 | Test: telemetry no-op when disabled (no OTel pull-in) |
| EC-M | SHOULD TEST | T8.1 | Test: dogfood regex validated against Telegram-rendered DOM |
| EC-N | DOCUMENT | D151 | Note: `.git` as file (worktrees) works via existsSync |
| EC-O | DOCUMENT | D151 | Note: ~50ms overhead for 20-level cwd × 6 specs |
| EC-P | DOCUMENT | T1.2 | Note: non-UTF8 / null-bytes accepted as-is (mojibake) |
| EC-Q | DOCUMENT | D156 / T2.1 | Note: `@path` only recognized on its own line |
| EC-R | DOCUMENT | D154 | Note: MDC nested directories not scanned in v1 |
| EC-S | DOCUMENT | D155 | Note: 120k cap appropriate for ≥1M windows |
| EC-T | DOCUMENT | T5.1 | Note: snapshot is refresh-time; users call `reload()` for freshness |

## Dependency Graph

```
Phase 0 (audit + lock Q1-Q10)
        │
        ▼
Phase 1 (DiscoverySpec + walk-to-git-root + multi-format loader)
        │
        ├──▶ Phase 2 (@import resolver, 5-hop + cycle detection)
        │
        ├──▶ Phase 3 (MDC parser for .cursor/rules)
        │
        └──▶ Phase 4 (size cap + truncation + telemetry)
                │
                ▼
        Phase 5 (.theokit/THEO.md + merge strategy + ContextPromptProvider integration)
                │
                ▼
        Phase 6 (backward-compat validation of .theokit/context/*.md)
                │
                ▼
        Phase 7 (10 ADRs + CHANGELOG + roadmap)
                │
                ▼
        Phase 8 (Dogfood QA — telegram-pro /context probe)
```

- Phases 2 + 3 + 4 are **parallelizable** after Phase 1 (independent modules).
- Phase 5 blocks on 1+2+3+4.
- Phases 6-8 are sequential after 5.

---

## Phase 0: Foundation — Lock decisions + audit baseline

### T0.1 — Confirm Q1-Q10 decisions + grep current FileContextManager surface

#### Objective
Verify the audit findings + lock the 10 design decisions (already drafted as ADRs D150-D159). No code changes.

#### Evidence
- Deep research report (2026-05-20) confirmed FileContextManager only loads `.theokit/context/*.md`, no root-level files.
- Hermes pattern in `referencia/hermes-agent/agent/prompt_builder.py:1417-1456` confirmed (first-match-wins, 20k cap).
- AGENTS.md adoption: 60k+ repos (Linux Foundation 2025).

#### Files to edit
```
.claude/knowledge-base/plans/context-files-coverage-plan.md — confirm via grep
```

#### Deep file dependency analysis
- Pure documentation/audit phase.

#### Tasks
1. `grep -n "AGENTS.md\|CLAUDE.md\|GEMINI.md\|.cursor/rules" packages/sdk/src/` → confirm zero current support.
2. `grep -n "loadMarkdownEntities" packages/sdk/src/internal/runtime/context-manager.ts` → confirm flat discovery.
3. Confirm `.theokit/` is the canonical config dir (per CLAUDE.md locked names).

#### TDD
None — pure audit phase.

#### Acceptance Criteria
- [ ] All grep checks return expected hits.
- [ ] ADRs D150-D159 drafted in this plan.

#### DoD
- [ ] Audit notes confirmed in phase commit message.

---

## Phase 1: Multi-format discovery + walk-to-git-root

### T1.1 — `DiscoverySpec` interface + `findGitRoot` helper + walk-up algorithm

#### Objective
Define the formal discovery contract. Replace the hardcoded `.theokit/context/` flat scan with a list of `DiscoverySpec` entries that each describe ONE file format + scope + parser.

#### Evidence
- Current `FileContextManager` uses a single `loadMarkdownEntities()` call → not extensible.
- Hermes/Gemini-CLI both walk to git-root (`.git/` directory marker).
- ADR D150 + D151.

#### Files to edit
```
packages/sdk/src/internal/runtime/context-discovery.ts (NEW) — DiscoverySpec interface + findGitRoot + walkUpForFile + walkUpForGlob
packages/sdk/src/internal/runtime/context-manager.ts — add #specs field, iterate specs in refresh()
packages/sdk/tests/internal/runtime/context-discovery.test.ts (NEW) — 12 unit tests
```

#### Deep file dependency analysis
- `context-discovery.ts` (NEW) — leaf module, no SDK runtime deps. Imports only `node:fs/promises` + `node:path`.
- `context-manager.ts` keeps its public `SDKContextManager` interface; only internal loading swap.
- Tests use `tmp-promise` (already a peer dep) to build fake repos.

#### Deep Dives

**`DiscoverySpec` interface:**

```typescript
export interface DiscoverySpec {
  /** Stable identifier — used as the `<source name="">` attribute and telemetry key. */
  id: string;
  /** Priority for merge (lower = earlier in prompt). D152. */
  priority: number;
  /** Single filename ("AGENTS.md") or glob (".cursor/rules/*.mdc"). */
  pattern: string;
  /** "cwd-only" | "git-root-walk" | "globbed". D151. */
  scope: "cwd-only" | "git-root-walk" | "globbed";
  /** Parser to apply once file is read. Plain markdown vs MDC frontmatter. D154. */
  parser: "plain-markdown" | "mdc" | "frontmatter-zod";
  /** Whether to follow @import directives. D156. */
  followImports: boolean;
}
```

**Default registry (`DEFAULT_DISCOVERY_SPECS`):**

```typescript
[
  { id: "AGENTS.md",        pattern: "AGENTS.md",          scope: "git-root-walk",  parser: "plain-markdown",    followImports: false, priority: 10 },
  { id: "GEMINI.md",        pattern: "GEMINI.md",          scope: "git-root-walk",  parser: "plain-markdown",    followImports: true,  priority: 20 },
  { id: "CLAUDE.md",        pattern: "CLAUDE.md",          scope: "git-root-walk",  parser: "plain-markdown",    followImports: true,  priority: 30 },
  { id: "cursor-rules",     pattern: ".cursor/rules/*.mdc", scope: "globbed",       parser: "mdc",               followImports: false, priority: 40 },
  { id: "theokit-context",  pattern: ".theokit/context/*.md", scope: "globbed",     parser: "frontmatter-zod",   followImports: false, priority: 50 },
  { id: "THEO.md",          pattern: ".theokit/THEO.md",   scope: "cwd-only",       parser: "plain-markdown",    followImports: false, priority: 60 },
]
```

**Algorithm — `findGitRoot(cwd)`:**

```
1. start = cwd
2. while true:
     if exists(join(start, ".git")) return start
     parent = dirname(start)
     if parent === start return undefined   // hit filesystem root
     start = parent
```

**Algorithm — `walkUpForFile(cwd, filename, stopDir)`:**

Returns ALL paths from cwd up to stopDir (inclusive) where `filename` exists, **nearest-first** (innermost dir first in the array). **NO `.gitignore` parsing** (EC-A) — pure `existsSync` walk. Resolved paths are normalized via `realpath` to dedup symlink chains pointing to the same physical file (EC-F).

**Invariants:**
- `findGitRoot` returns `undefined` for non-git workspaces → falls back to cwd-only.
- `walkUpForFile` never returns paths outside the git-root (security).
- Symlinks are NOT followed across the git-root boundary (security).
- Empty `cwd` → throw `ConfigurationError`.

**Edge cases:**
- **EC-1:** Workspace not in a git repo → `findGitRoot` returns `undefined`; walk degrades to cwd-only.
- **EC-2:** `cwd` is exactly the git-root → walk yields a single entry (or zero if file absent).
- **EC-3:** `cwd` is inside a submodule with its own `.git/` → submodule's `.git` is the stop, not the outer repo's.
- **EC-4:** Filename contains path traversal (e.g. `../CLAUDE.md`) → reject via `sanitizeIdentifier`-style guard (D81 parity).
- **EC-5:** Filesystem race during walk (file deleted mid-iteration) → graceful skip.

#### Tasks
1. Create `context-discovery.ts` with `DiscoverySpec`, `DEFAULT_DISCOVERY_SPECS`, `findGitRoot`, `walkUpForFile`, `walkUpForGlob`.
2. Add `sanitizePattern` guard for traversal protection.
3. Wire `#specs: DiscoverySpec[]` field into `FileContextManager`; default to `DEFAULT_DISCOVERY_SPECS`.
4. Write tests.

#### TDD
```
RED:     test_findGitRoot_returns_dir_with_dot_git()
RED:     test_findGitRoot_walks_up_until_found()
RED:     test_findGitRoot_returns_undefined_when_no_git()
RED:     test_findGitRoot_handles_worktree_dot_git_as_file() — EC-N
RED:     test_walkUpForFile_returns_nearest_first()
RED:     test_walkUpForFile_stops_at_git_root()
RED:     test_walkUpForFile_returns_empty_when_no_match()
RED:     test_walkUpForFile_handles_symlinks_without_crossing_root() — EC: security guard
RED:     test_walkUpForFile_realpath_dedup_for_symlink_chains() — EC-F: same physical file via symlinks deduped
RED:     test_submodule_dot_git_is_canonical_stop() — EC-3
RED:     test_path_traversal_pattern_rejected() — EC-4 + D81 parity
RED:     test_filesystem_race_graceful_skip() — EC-5
RED:     test_default_specs_contain_all_6_entries()
RED:     test_specs_sorted_by_priority_ascending()
GREEN:   Implement discovery helpers + spec registry.
REFACTOR: None expected — gitignore parsing dropped per EC-A.
VERIFY:  pnpm vitest run tests/internal/runtime/context-discovery.test.ts
```

#### Acceptance Criteria
- [ ] 14 RED tests GREEN (was 12 — +2 from EC-N worktree + EC-F symlink dedup)
- [ ] File ≤300 LoC
- [ ] Zero biome warnings
- [ ] Cognitive complexity ≤10 on every function
- [ ] Knip clean (DiscoverySpec re-exported if public, or internal-only)
- [ ] **No `.gitignore` parsing** (EC-A) and **no `.theokitignore`** (EC-B)

#### DoD
- [ ] CHANGELOG entry under `[Unreleased]`
- [ ] Existing 1062 SDK tests pass (FileContextManager only added a private field)

---

### T1.2 — Plain-markdown loader + size cap + truncation

#### Objective
Implement the `plain-markdown` parser path: read file, apply 40k char cap with 70/20 head/tail truncation + marker. Emit telemetry counter on truncation.

#### Evidence
- ADRs D155 + D159.
- Hermes precedent (`referencia/hermes-agent/agent/prompt_builder.py:1292-1301`).

#### Files to edit
```
packages/sdk/src/internal/runtime/context-loaders.ts (NEW) — loadPlainMarkdown + truncateWithMarker
packages/sdk/src/internal/runtime/context-manager.ts — wire loader into refresh()
packages/sdk/tests/internal/runtime/context-loaders.test.ts (NEW) — 8 unit tests
```

#### Deep file dependency analysis
- `context-loaders.ts` (NEW) — leaf module, depends on telemetry tracer (lazy import).
- Tests use synthetic strings of known size.

#### Deep Dives

**`loadPlainMarkdown(absPath, opts: { maxBytesPerFile: number })`:**

```typescript
async function loadPlainMarkdown(absPath: string, opts): Promise<LoadedSource> {
  const content = await readFile(absPath, "utf8");
  const { truncated, finalContent } = truncateWithMarker(content, opts.maxBytesPerFile);
  if (truncated) emitTelemetry("context_files_truncated", { file: absPath });
  return { source: absPath, content: finalContent, originalBytes: content.length, truncated };
}
```

**`truncateWithMarker(content: string, max: number)`:**

```typescript
const HEAD_RATIO = 0.7;
const TAIL_RATIO = 0.2;
const MARKER = "\n\n…[truncated by theokit]\n\n";

function truncateWithMarker(content, max) {
  if (content.length <= max) return { truncated: false, finalContent: content };
  // EC-C: when max is smaller than the marker itself, skip the marker
  // entirely and return a head-only slice. Prevents budget = max - MARKER.length
  // from going negative and producing wrong-end slice() behaviour.
  if (max <= MARKER.length) {
    return { truncated: true, finalContent: content.slice(0, max) };
  }
  const budget = max - MARKER.length;
  const headBytes = Math.floor(budget * (HEAD_RATIO / (HEAD_RATIO + TAIL_RATIO)));
  const tailBytes = budget - headBytes;
  return {
    truncated: true,
    finalContent: content.slice(0, headBytes) + MARKER + content.slice(-tailBytes),
  };
}
```

**Invariants:**
- `finalContent.length <= max` always.
- When `content.length <= max`, content is returned verbatim (no marker).
- Marker is byte-for-byte identical across truncations (telemetry/grep-friendly).
- Head and tail never overlap (`headBytes + tailBytes + MARKER.length <= max`).

**Edge cases:**
- **EC-6:** `content.length === max` → no truncation.
- **EC-7:** `content.length === max + 1` → truncation fires (smallest possible).
- **EC-8 / EC-H:** Multi-byte UTF-8 char split mid-codepoint at boundary → use `Buffer.from + slice` OR document that we slice on JS character boundary; head/tail being safe with codepoints matters more than byte-exact cap. Test asserts `Buffer.isUtf8(finalContent)` passes.
- **EC-9:** Empty file → return `{ truncated: false, finalContent: "" }`.
- **EC-10:** `maxBytesPerFile === 0` → return empty + truncated:true.
- **EC-C:** `0 < maxBytesPerFile <= MARKER.length` (≈35 chars) → return head-only slice WITHOUT marker (guard at start of function). Prevents `budget < 0` bug.
- **EC-P (documented):** Non-UTF8 file content read as `utf8` produces U+FFFD replacement chars. Accepted as-is — KISS, user puts binary in `.md` at their own risk.
- **EC-G:** File scheduled by discovery but deleted before read (FS race) → `loadPlainMarkdown` catches ENOENT and returns `undefined`; never throws.
- **EC-L:** When telemetry is disabled (default off per D34), the lazy `tracer` import is a no-op; counter calls do NOT pull OTel into the import graph.

#### Tasks
1. Implement `truncateWithMarker` (pure function).
2. Implement `loadPlainMarkdown` (FS + truncate).
3. Add telemetry counter integration (lazy-load `tracer` to avoid pulling OTel into hot path).
4. Tests.

#### TDD
```
RED:     test_content_under_max_returns_verbatim()
RED:     test_content_at_exact_max_not_truncated() — EC-6
RED:     test_content_just_over_max_truncates() — EC-7
RED:     test_head_and_tail_present_in_output()
RED:     test_marker_present_in_truncated_output()
RED:     test_finalContent_length_never_exceeds_max()
RED:     test_empty_file_returns_empty() — EC-9
RED:     test_max_below_marker_length_returns_head_only_no_marker() — EC-C guard
RED:     test_truncation_at_multibyte_boundary_keeps_valid_utf8() — EC-H
RED:     test_telemetry_counter_emitted_on_truncation() — D159
RED:     test_telemetry_noop_when_telemetry_disabled() — EC-L
RED:     test_loadPlainMarkdown_missing_file_returns_undefined_not_throw() — EC-G
GREEN:   Implement + wire telemetry (lazy tracer import).
REFACTOR: None expected.
VERIFY:  pnpm vitest run tests/internal/runtime/context-loaders.test.ts
```

#### Acceptance Criteria
- [ ] 12 RED tests GREEN (was 8 — +4 from EC-C, EC-H, EC-L, EC-G)
- [ ] `truncateWithMarker` is pure (no I/O, no telemetry)
- [ ] Marker guard `if (max <= MARKER.length)` present (EC-C)
- [ ] File ≤200 LoC
- [ ] Cognitive complexity ≤10

#### DoD
- [ ] CHANGELOG entry
- [ ] All 1062+ tests green

---

## Phase 2: `@import` resolver

### T2.1 — Implement `@path` import directive with 5-hop cycle detection

#### Objective
Parse `@path/to/file` directives in CLAUDE.md / GEMINI.md content, recursively resolve them with a 5-hop depth limit and cycle detection.

#### Evidence
- Anthropic CLAUDE.md spec: `@path/to/file` syntax, 5-hop max, supports `~/`.
- Google Gemini CLI uses identical syntax.
- ADR D156.

#### Files to edit
```
packages/sdk/src/internal/runtime/context-import-resolver.ts (NEW) — resolveImports(content, basePath, opts)
packages/sdk/src/internal/runtime/context-loaders.ts — call resolveImports when DiscoverySpec.followImports is true
packages/sdk/tests/internal/runtime/context-import-resolver.test.ts (NEW) — 10 unit tests
```

#### Deep file dependency analysis
- Pure function module; depends only on `node:fs/promises` + `node:path`.

#### Deep Dives

**Resolver algorithm:**

> **EC-D fix:** every imported file is itself capped at `maxBytesPerFile` via `truncateWithMarker` BEFORE being concatenated. A CLAUDE.md with 5 imports of 30k chars each would otherwise balloon to 150k chars of imported content before the per-file cap fires on the final result. Per-import truncation keeps each piece readable.

```typescript
const IMPORT_RE = /^@([^\s\n]+)$/gm; // line-anchored; @path on its own line (EC-Q)
const MAX_HOPS = 5;

async function resolveImports(content: string, basePath: string, opts: {
  visited: Set<string>;       // absolute paths already resolved (cycle detection)
  depth: number;
  maxBytesPerFile: number;    // EC-D: cap each imported file individually
}): Promise<string> {
  if (opts.depth >= MAX_HOPS) {
    return content + `\n\n…[@import depth limit ${MAX_HOPS} reached]\n\n`;
  }
  const baseDir = dirname(basePath);
  // Sequential resolve (replaceAsync helper).
  return await replaceAsync(content, IMPORT_RE, async (raw) => {
    const resolved = raw.startsWith("~/")
      ? join(homedir(), raw.slice(2))
      : raw.startsWith("/")
        ? raw
        : join(baseDir, raw);
    const absolute = resolvePath(resolved);
    if (opts.visited.has(absolute)) return `[@import cycle detected: ${raw}]`;
    opts.visited.add(absolute);
    try {
      // EC-D: load + truncate per-file BEFORE recursing into its imports.
      const loaded = await loadPlainMarkdown(absolute, { maxBytesPerFile: opts.maxBytesPerFile });
      if (loaded === undefined) return `[@import not found: ${raw}]`;
      return await resolveImports(loaded.content, absolute, {
        visited: opts.visited,
        depth: opts.depth + 1,
        maxBytesPerFile: opts.maxBytesPerFile,
      });
    } catch {
      return `[@import not found: ${raw}]`;
    }
  });
}
```

**Note:** `String.prototype.replace` with async callback needs the `replaceAsync` pattern (split + Promise.all). Pseudocode above is illustrative; real impl uses sequential resolve.

**Invariants:**
- Cycle detection is based on absolute resolved paths (not on raw `@x`).
- Hop depth NEVER exceeds 5.
- Missing files emit a `[@import not found: x]` placeholder; do NOT throw (graceful degrade).
- Relative imports resolve against the importing file's directory, not the cwd.
- `~/` expands to `os.homedir()`.

**Edge cases:**
- **EC-11:** Self-import `@self.md` from `self.md` → cycle detected after 1 hop.
- **EC-12:** Diamond import (A → B + C, B → D, C → D) → D resolved once (visited dedup).
- **EC-13:** Chain longer than 5 hops → depth-limit marker.
- **EC-14:** Import path contains spaces → only first non-space token is taken.
- **EC-15:** `@` inside an inline code block → still matches (we don't parse markdown structure). Document as a limitation; users avoid `@path` in code unless they want resolution.
- **EC-16:** Import is to an empty file → emit empty content (no placeholder).
- **EC-17:** Absolute path outside git-root → resolved verbatim (no walk-up); security: do not allow writes via imports — we only READ.

#### Tasks
1. Implement `resolveImports` with async sequential resolution.
2. Implement `replaceAsync` helper.
3. Tests covering EC-11 through EC-17.

#### TDD
```
RED:     test_single_import_resolves_content()
RED:     test_nested_import_resolves_recursively()
RED:     test_5_hop_depth_limit_emits_marker() — EC-13
RED:     test_cycle_detected_emits_marker() — EC-11
RED:     test_diamond_import_resolves_once_per_file() — EC-12
RED:     test_missing_import_emits_placeholder()
RED:     test_relative_import_resolves_against_importer_dir()
RED:     test_tilde_expansion_to_homedir()
RED:     test_absolute_import_resolves_verbatim()
RED:     test_empty_import_returns_empty_content() — EC-16
RED:     test_imported_file_capped_at_maxBytesPerFile() — EC-D: per-import truncation
RED:     test_inline_at_path_not_on_own_line_not_resolved() — EC-Q
GREEN:   Implement + cycle tracking + per-import truncation.
REFACTOR: None expected.
VERIFY:  pnpm vitest run tests/internal/runtime/context-import-resolver.test.ts
```

#### Acceptance Criteria
- [ ] 12 RED tests GREEN (was 10 — +2 from EC-D + EC-Q)
- [ ] Cycle detection works in linear time
- [ ] Per-import truncation applied (EC-D)
- [ ] File ≤250 LoC
- [ ] Cognitive complexity ≤10

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

## Phase 3: MDC parser for `.cursor/rules`

### T3.1 — Parse `.cursor/rules/*.mdc` with frontmatter (globs / description / alwaysApply)

#### Objective
Implement the MDC parser for Cursor's current format. Honor `alwaysApply: true` unconditionally; for `alwaysApply: false`, gate by `globs` matching against the current turn's touched-files set (or empty set if no info).

#### Evidence
- Cursor docs (current): `.mdc` files have YAML frontmatter `globs` / `description` / `alwaysApply`. Legacy `.cursorrules` silently ignored in Agent mode.
- ADR D150 + D154.

#### Files to edit
```
packages/sdk/src/internal/runtime/context-mdc-parser.ts (NEW) — parseMdc(content, opts)
packages/sdk/src/internal/runtime/context-loaders.ts — wire MDC path when DiscoverySpec.parser === "mdc"
packages/sdk/tests/internal/runtime/context-mdc-parser.test.ts (NEW) — 8 unit tests
```

#### Deep file dependency analysis
- New module reuses existing markdown frontmatter parser (`internal/persistence/markdown-config-loader.ts`) via a different Zod schema.
- Glob matching uses `minimatch` (check peer deps; add if missing).

#### Deep Dives

**MDC schema (Zod):**

```typescript
const McdFrontmatterSchema = z.object({
  description: z.string().optional(),
  globs: z.array(z.string()).optional(),
  alwaysApply: z.boolean().optional(),
});
```

**Activation logic:**

> **EC-I clarification:** at `agent.send()` time, `touchedFiles = []` (we have no signal about what the agent will read next). Only `alwaysApply: true` rules activate. Per-glob activation arrives in v2 when we hook the file-read pipeline. Description-based "agent requested" activation (Cursor's intent classification) is explicitly out of scope.

```typescript
function shouldActivate(fm: McdFrontmatter, touchedFiles: ReadonlyArray<string>): boolean {
  if (fm.alwaysApply === true) return true;
  if (fm.globs === undefined || fm.globs.length === 0) return false;
  return touchedFiles.some((f) => fm.globs.some((g) => minimatch(f, g)));
}
```

**Invariants:**
- `alwaysApply: true` → always include the rule body.
- `alwaysApply: false` + no globs → never include (no signal for activation).
- Description-only rules (no globs, no alwaysApply) → never auto-activate in v1.
- Malformed frontmatter → log warning, skip file (don't throw).

**Edge cases:**
- **EC-18:** `.mdc` file without `---` frontmatter → treat as plain markdown with `alwaysApply: true`.
- **EC-19:** `globs: ["**/*.ts"]` matches any TS file in the current touched-files set.
- **EC-20:** `touchedFiles` is empty (start of session) → only `alwaysApply: true` rules activate.
- **EC-21:** YAML parse error → warn + skip + emit telemetry counter `context_mdc_parse_error`.
- **EC-22:** Two MDC files with overlapping `globs` → both activate; concat per priority order.

#### Tasks
1. Implement `parseMdc` with Zod validation.
2. Implement `shouldActivate` with minimatch.
3. Wire into context-loaders for `mdc` parser path.
4. Tests.

#### TDD
```
RED:     test_alwaysApply_true_always_activates()
RED:     test_alwaysApply_false_with_matching_glob_activates() — EC-19
RED:     test_alwaysApply_false_with_no_matching_glob_skipped()
RED:     test_empty_touched_files_only_alwaysApply_true() — EC-20 + EC-I (v1 semantic)
RED:     test_no_frontmatter_treated_as_alwaysApply_true() — EC-18
RED:     test_malformed_yaml_warns_and_skips() — EC-21
RED:     test_overlapping_globs_both_activate() — EC-22
RED:     test_telemetry_counter_on_parse_error()
GREEN:   Implement parser + activation logic.
REFACTOR: None expected.
VERIFY:  pnpm vitest run tests/internal/runtime/context-mdc-parser.test.ts
```

#### Acceptance Criteria
- [ ] 8 RED tests GREEN
- [ ] `minimatch` added to peer deps if not present (verified at install time)
- [ ] File ≤250 LoC
- [ ] Knip clean

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

## Phase 4: Total-aggregate cap + merge strategy

### T4.1 — Aggregate truncation when total exceeds 120k chars

#### Objective
Implement the second-level cap: after all per-file truncations, if the sum still exceeds `maxBytesTotal`, drop lower-priority files entirely (highest priority survives).

#### Evidence
- ADR D155 (120k total cap).
- Without this, 6 fully-populated files × 40k = 240k chars → blows even Gemini 2.5's 2M window for token-cost reasons.

#### Files to edit
```
packages/sdk/src/internal/runtime/context-aggregator.ts (NEW) — applyAggregateCap(sources, maxTotal)
packages/sdk/src/internal/runtime/context-manager.ts — call aggregator after per-file loading
packages/sdk/tests/internal/runtime/context-aggregator.test.ts (NEW) — 6 unit tests
```

#### Deep file dependency analysis
- Pure function. Inputs: sorted-by-priority `LoadedSource[]`. Outputs: filtered list + per-file truncation events.

#### Deep Dives

**Algorithm:**

```typescript
function applyAggregateCap(sources: LoadedSource[], maxTotal: number) {
  let totalBytes = 0;
  const kept: LoadedSource[] = [];
  const dropped: LoadedSource[] = [];
  for (const s of sources) {
    if (totalBytes + s.content.length <= maxTotal) {
      kept.push(s);
      totalBytes += s.content.length;
    } else {
      const remaining = maxTotal - totalBytes;
      if (remaining > 0) {
        // Partial keep: truncate this one to fit.
        const { finalContent } = truncateWithMarker(s.content, remaining);
        kept.push({ ...s, content: finalContent, truncated: true });
        totalBytes = maxTotal;
      } else {
        dropped.push(s);
      }
    }
  }
  if (dropped.length > 0) emitTelemetry("context_files_total_truncated", { dropped: dropped.map((d) => d.source) });
  return { kept, dropped };
}
```

**Invariants:**
- Sum of `kept[].content.length` <= `maxTotal`.
- Priority order is preserved.
- Last source CAN be partially truncated to fit exactly into remaining budget.
- All dropped sources are lower-priority than all kept sources.
- **EC-J:** When two sources share the same `priority`, tie-break by absolute source path lex-ascending (`a.source.localeCompare(b.source)`). This guarantees deterministic ordering across runs — load order independence — which is critical for prompt-cache stability.

**Edge cases:**
- **EC-23:** Empty input → empty output.
- **EC-24:** Single source bigger than maxTotal → that single source is truncated to maxTotal.
- **EC-25:** Total exactly equals maxTotal → no drops.

#### Tasks
1. Implement `applyAggregateCap`.
2. Tests.
3. Wire into context-manager.

#### TDD
```
RED:     test_under_total_keeps_all()
RED:     test_at_exact_total_keeps_all() — EC-25
RED:     test_just_over_total_truncates_last_partial()
RED:     test_well_over_total_drops_lower_priority()
RED:     test_single_huge_source_truncated_to_max() — EC-24
RED:     test_telemetry_emitted_on_drop()
RED:     test_same_priority_tiebreak_by_path_lex_deterministic() — EC-J: prompt-cache stability
GREEN:   Implement + telemetry wiring + tie-break.
REFACTOR: None expected.
VERIFY:  pnpm vitest run tests/internal/runtime/context-aggregator.test.ts
```

#### Acceptance Criteria
- [ ] 7 RED tests GREEN (was 6 — +1 from EC-J tie-break)
- [ ] File ≤150 LoC
- [ ] Cognitive complexity ≤10

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

## Phase 5: `.theokit/THEO.md` + merge strategy + ContextPromptProvider integration

### T5.1 — Wire all loaders + merge order into FileContextManager

#### Objective
Integrate Phase 1-4 outputs in the right order; emit final merged content to `ContextPromptProvider`. Verify the system prompt block shape preserves source attribution.

#### Evidence
- ADR D152 (concat-by-priority).
- Current `ContextPromptProvider` wraps each source in `<source name="...">` — we keep that.

#### Files to edit
```
packages/sdk/src/internal/runtime/context-manager.ts — wire discovery + loaders + aggregator
packages/sdk/src/internal/runtime/context-provider.ts — verify <context> block emits sources in priority order
packages/sdk/tests/internal/runtime/context-manager-multi-format.test.ts (NEW) — 10 integration tests
```

#### Deep file dependency analysis
- `context-manager.ts` keeps SDKContextManager public interface unchanged.
- New private fields: `#discoverySpecs`, `#maxBytesPerFile`, `#maxBytesTotal`.
- Public API additions in `AgentOptions.context`: `maxBytesPerFile?`, `maxBytesTotal?`, `discoverySpecs?` (advanced override).

#### Deep Dives

**Integration flow inside `refresh()`:**

```typescript
async refresh(): Promise<void> {
  const gitRoot = await findGitRoot(this.cwd);
  const stopDir = gitRoot ?? this.cwd;
  const allSources: LoadedSource[] = [];
  for (const spec of this.#discoverySpecs) {
    const paths = await discoverPaths(spec, this.cwd, stopDir);
    for (const path of paths) {
      const raw = await loadByParser(spec.parser, path, { maxBytesPerFile: this.#maxBytesPerFile });
      const resolved = spec.followImports
        ? await resolveImports(raw.content, path, { visited: new Set(), depth: 0 })
        : raw.content;
      allSources.push({ id: spec.id, source: path, content: resolved, priority: spec.priority });
    }
  }
  allSources.sort((a, b) => a.priority - b.priority);
  const { kept } = applyAggregateCap(allSources, this.#maxBytesTotal);
  this.state = { loadedSources: kept.map(toContextSource) };
}
```

**Public API addition (`AgentOptions.context`):**

```typescript
interface ContextSettings {
  // ... existing fields
  /** Max bytes per individual context file. Default 40_000. */
  maxBytesPerFile?: number;
  /** Max bytes across all context files (aggregate cap). Default 120_000. */
  maxBytesTotal?: number;
  /** Advanced — override the default discovery spec registry. */
  discoverySpecs?: DiscoverySpec[];
}
```

**Invariants:**
- `<context>` block in system prompt presents sources in priority-ascending order.
- Each source has `<source name="...">` attribute matching `spec.id`.
- Multiple files of same spec (e.g. 3 nested AGENTS.md) get disambiguation. **EC-E privacy fix:** disambiguation uses **relative-to-git-root** path (or relative-to-cwd if non-git), NEVER absolute. Format: `name="AGENTS.md@packages/foo"` (relative), never `name="AGENTS.md@/home/user/secret-project/packages/foo"`. Prevents leaking the developer's home directory and project name into the LLM provider's logs / cache.
- Backward compat: `.theokit/context/*.md` Zod-frontmatter sources still resolve correctly via `parser: "frontmatter-zod"`.
- Context snapshot is **refresh-time** (EC-T): modifying AGENTS.md mid-flight does NOT auto-update; user calls `agent.reload()` or `Agent.create()` again to pick up changes.

**Edge cases:**
- **EC-26:** No files exist in any spec → empty `<context>` block (or omit entirely).
- **EC-27:** Single AGENTS.md + single CLAUDE.md → both appear in priority order.
- **EC-28:** AGENTS.md at root + nested AGENTS.md → both appear, distinct `name` attributes.
- **EC-29:** Spec with `scope: "cwd-only"` finds file → single entry (no walk).
- **EC-30:** Two specs match the SAME physical file (e.g. user symlinks AGENTS.md → CLAUDE.md) → deduplication by absolute path; first spec to win by priority claims it.

#### Tasks
1. Implement `discoverPaths` dispatcher (per-spec scope handling).
2. Implement `loadByParser` dispatcher.
3. Wire `refresh()` end-to-end.
4. Add public options to `ContextSettings`.
5. Disambiguation logic for multiple files of same spec.
6. Tests.

#### TDD
```
RED:     test_AGENTS_md_at_cwd_discovered()
RED:     test_CLAUDE_md_walk_up_to_git_root_discovered()
RED:     test_GEMINI_md_with_at_import_resolved()
RED:     test_cursor_rules_mdc_with_alwaysApply_included()
RED:     test_THEO_md_in_dot_theokit_discovered()
RED:     test_backward_compat_theokit_context_md_still_works() — EC: D158
RED:     test_merge_order_is_priority_ascending() — EC-27
RED:     test_nested_AGENTS_md_disambiguated_by_relative_path() — EC-28 + EC-E
RED:     test_disambiguation_never_includes_absolute_path() — EC-E privacy
RED:     test_disambiguation_uses_git_root_relative_not_cwd_relative() — EC-E correctness
RED:     test_symlink_dedup_via_absolute_path() — EC-30
RED:     test_no_files_anywhere_yields_empty_context_block() — EC-26
GREEN:   Wire end-to-end with EC-E privacy guard.
REFACTOR: Extract dispatchers if cognitive complexity > 10.
VERIFY:  pnpm vitest run tests/internal/runtime/context-manager-multi-format.test.ts
```

#### Acceptance Criteria
- [ ] 12 RED tests GREEN (was 10 — +2 from EC-E privacy)
- [ ] `agent.context.snapshot()` includes all discovered sources
- [ ] System prompt `<context>` block preserves priority order
- [ ] **No absolute paths in any `<source name="">` attribute** (EC-E grep test)
- [ ] Public API additions documented in JSDoc (including EC-T refresh-time snapshot caveat)
- [ ] Zero biome warnings; knip clean

#### DoD
- [ ] CHANGELOG entry
- [ ] 1062 baseline + ~35 new tests = ~1097 PASS

---

## Phase 6: Backward-compat validation

### T6.1 — Verify existing `.theokit/context/*.md` sources behave identically

#### Objective
Run telegram-pro's existing `bot-readme.md` context source through the new loader; confirm `agent.context.snapshot()` output is byte-identical to baseline.

#### Evidence
- `examples/telegram-pro/.theokit/context/bot-readme.md` is in-tree; must keep working.
- Third-party SDK users likely have the same pattern.

#### Files to edit
```
packages/sdk/tests/internal/runtime/context-backward-compat.test.ts (NEW) — 4 regression tests
```

#### Deep file dependency analysis
- Tests build a fake `.theokit/context/foo.md` file with Zod frontmatter, run loader, snapshot output.

#### Deep Dives

**Regression matrix:**
- `.theokit/context/X.md` with `enabled: false` → excluded.
- `.theokit/context/X.md` with `maxTokens` per-source → respected.
- `.theokit/context/X.md` with no frontmatter → fail with same error as before (or migrate gracefully).
- Old `.theokit/context.json` config → still emits one-time stderr deprecation warning.

#### Tasks
1. Write 4 regression tests.

#### TDD
```
RED:     test_enabled_false_excludes_source()
RED:     test_maxTokens_per_source_honored()
RED:     test_no_frontmatter_fails_with_same_error_as_baseline()
RED:     test_legacy_context_json_still_emits_warning()
RED:     test_legacy_context_json_loads_content_not_just_warns() — EC-K: actually carrega o conteúdo apontado, não só warn
GREEN:   No new code — relies on Phase 5 wiring.
REFACTOR: None expected.
VERIFY:  pnpm vitest run tests/internal/runtime/context-backward-compat.test.ts
```

#### Acceptance Criteria
- [ ] 5 tests GREEN (was 4 — +1 from EC-K)
- [ ] `examples/telegram-pro` runs unchanged
- [ ] Legacy `.theokit/context.json` loads CONTENT, not just emits warning (EC-K)

#### DoD
- [ ] CHANGELOG: explicit "Backward compatible" line

---

## Phase 7: ADRs + CHANGELOG + roadmap

### T7.1 — Write 10 ADRs D150-D159

#### Files to edit
```
.claude/knowledge-base/adrs/D150-context-files-coverage-set.md (NEW)
.claude/knowledge-base/adrs/D151-context-walk-up-git-root.md (NEW)
.claude/knowledge-base/adrs/D152-context-merge-concat-by-priority.md (NEW)
.claude/knowledge-base/adrs/D153-theo-md-in-dot-theokit.md (NEW)
.claude/knowledge-base/adrs/D154-context-plain-markdown-default.md (NEW)
.claude/knowledge-base/adrs/D155-context-size-caps.md (NEW)
.claude/knowledge-base/adrs/D156-context-import-syntax.md (NEW)
.claude/knowledge-base/adrs/D157-context-lazy-nested-claude-deferred.md (NEW)
.claude/knowledge-base/adrs/D158-context-backward-compat-theokit-context.md (NEW)
.claude/knowledge-base/adrs/D159-context-truncation-telemetry.md (NEW)
```

#### Tasks
1. Write each ADR (Date, Status, Decision, Rationale, Consequences format).

#### Acceptance Criteria
- [ ] 10 ADR files
- [ ] Each ≤150 LoC
- [ ] CLAUDE.md ADR table updated

---

### T7.2 — CHANGELOG + CLAUDE.md SDK Roadmap row #4 → ✅ DONE

#### Files to edit
```
packages/sdk/CHANGELOG.md — under [Unreleased]: v1.13 context-files-coverage section
CLAUDE.md — Roadmap row #4 → DONE; ADR table append D150-D159
```

#### Acceptance Criteria
- [ ] CHANGELOG entry references all 10 ADRs + new types/options
- [ ] Roadmap row #4 strikethrough

#### DoD
- [ ] Documentation committed

---

## Phase 8: Dogfood QA (MANDATORY)

### T8.1 — Telegram-pro `/context` probe

#### Objective
Add `/context` command to telegram-pro that lists discovered context files + their sizes + truncation status. Manually create a repo-root `AGENTS.md` and `CLAUDE.md` in `examples/telegram-pro/` to verify discovery + walk-up works.

#### Evidence
- Every prior plan has a telegram-pro dogfood probe; consistency.
- Real-LLM rule: end-to-end validation against `agent.context.snapshot()`.

#### Files to edit
```
examples/telegram-pro/src/index.ts — add /context command
examples/telegram-pro/AGENTS.md (NEW) — sample content for discovery
examples/telegram-pro/CLAUDE.md (NEW) — sample content for discovery
.claude/skills/telegram-pro-dogfood/lib/dogfood.mjs — add scenario #36
```

#### Deep Dives

`/context` command:

```typescript
bot.command("context", async (ctx) => {
  const agent = await Agent.create({ apiKey: API_KEY, model: ..., local: { cwd: CWD } });
  try {
    const snap = await agent.context!.snapshot();
    const lines = snap.sources.map((s) =>
      `• ${s.name} (${s.path}, ${s.status}, ~${s.tokens ?? "?"} tokens)`
    );
    await ctx.reply(`*Context files discovered:*\n${lines.join("\n")}`);
  } finally {
    await agent.dispose();
  }
});
```

Dogfood scenario:

```javascript
{
  text: "/context",
  expect: [/Context files discovered/i, /AGENTS\.md|CLAUDE\.md|bot-readme/],
  waitMs: 10_000,
}
```

#### Tasks
1. Create `examples/telegram-pro/AGENTS.md` with realistic content (≤2k chars).
2. Create `examples/telegram-pro/CLAUDE.md` with realistic content (≤2k chars).
3. Implement `/context` command in telegram-pro index.ts.
4. Add dogfood scenario.
5. Run full dogfood.

#### Acceptance Criteria
- [ ] `/context` lists at least 3 sources (AGENTS.md, CLAUDE.md, bot-readme)
- [ ] Dogfood: PASS + SKIP == total
- [ ] Real-LLM evidence: at least one bot reply visibly cites information from AGENTS.md or CLAUDE.md content
- [ ] **EC-M:** Dogfood regex validated against Telegram-rendered DOM (asterisks stripped by Markdown V1 renderer) — pre-flight `--only "/context"` run BEFORE full suite to confirm pattern bate

---

### T8.2 — Full validate + push

#### Execution
```bash
pnpm -w run validate
node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id 7528967933
```

#### Acceptance Criteria
- [ ] `pnpm validate` exit 0
- [ ] Dogfood 32+/36 PASS
- [ ] Real-LLM evidence captured

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Roadmap claim "loads CLAUDE.md/AGENTS.md" is wrong | T0.1 | Audit + correct in ADRs/plan context |
| 2 | No AGENTS.md support | T1.1 | DiscoverySpec for AGENTS.md + git-root walk |
| 3 | No CLAUDE.md support | T1.1, T2.1 | Walk-up + @import resolution |
| 4 | No GEMINI.md support | T1.1, T2.1 | Same shape as CLAUDE.md |
| 5 | No `.cursor/rules/*.mdc` support | T3.1 | MDC parser + glob activation |
| 6 | No SDK-specific override | T5.1 | `.theokit/THEO.md` loader |
| 7 | No walk-to-git-root | T1.1 | `findGitRoot` + `walkUpForFile` |
| 8 | No `@import` resolution | T2.1 | Resolver with 5-hop + cycle detection |
| 9 | No size cap per file | T1.2 | 40k cap + 70/20 truncation + marker |
| 10 | No total aggregate cap | T4.1 | 120k aggregate cap with drop |
| 11 | No truncation telemetry | T1.2, T4.1 | `context_files_truncated` counter |
| 12 | Risk of `.theokit/context/*.md` regression | T6.1 | Backward-compat regression tests |
| 13 | No ADRs documenting decisions | T7.1 | 10 ADRs D150-D159 |
| 14 | CHANGELOG + roadmap not updated | T7.2 | CHANGELOG + row #4 → DONE |
| 15 | No dogfood scenario | T8.1 | `/context` command + scenario #36 |
| 16 | Push gate must pass | T8.2 | `pnpm validate` exit 0 |
| 17 | Lazy-nested CLAUDE.md scope | (deferred per D157) | Documented as v2 followup |
| 18 | SOUL.md, .hermes.md, .cursorrules legacy NOT loaded | (deferred per D150) | Documented in ADR as conscious non-goal |
| 19 | **EC-A:** `.gitignore` parsing inflates implementation for 0% real benefit | T1.1 / D151 | Drop gitignore respect; pure existsSync walk |
| 20 | **EC-B:** `.theokitignore` is invented scope creep | T1.1 / D151 | Drop from plan; revisit in v2 if signal emerges |
| 21 | **EC-C:** Truncation marker bug when `max ≤ MARKER.length` | T1.2 | Guard at start of `truncateWithMarker` |
| 22 | **EC-D:** Imports balloon past per-file cap | T2.1 | Pass `maxBytesPerFile` into `resolveImports`; cap each imported file |
| 23 | **EC-E:** Disambiguation leaks absolute paths to LLM provider (privacy) | T5.1 | Use `relative(gitRoot ?? cwd, dirname(path))` |
| 24 | **EC-F:** Symlink chains pointing to same physical file load twice | T1.1 | `realpath` dedup |
| 25 | **EC-G:** Loader throws on FS-race deletion | T1.2 | Catch ENOENT, return undefined |
| 26 | **EC-H:** Truncation splits UTF-8 codepoints | T1.2 | Test asserts `Buffer.isUtf8` post-slice |
| 27 | **EC-I:** Unclear when `touchedFiles` is populated | T3.1 | Document v1 semantic: empty at send-time, only `alwaysApply: true` activates |
| 28 | **EC-J:** Same-priority sort non-deterministic | T4.1 | Tie-break by path lex (prompt-cache stability) |
| 29 | **EC-K:** Legacy JSON config behavior unverified | T6.1 | Test: content actually loads, not just warning |
| 30 | **EC-L:** Telemetry might pull OTel into hot path when disabled | T1.2 | Lazy tracer import + assertion test |
| 31 | **EC-M:** Dogfood regex may not match Telegram-rendered output | T8.1 | Pre-flight `--only` validation before full run |

**Coverage: 31/31 gaps (100%)**

## Global Definition of Done

- [ ] All 8 phases completed
- [ ] All tests passing across workspace (≥1100 total — adds ~38 new tests from this plan + EC-A through EC-M)
- [ ] Zero biome warnings; zero knip warnings
- [ ] `AgentOptions.context.maxBytesPerFile` + `maxBytesTotal` + `discoverySpecs` exposed in public type
- [ ] 10 new ADRs (D150-D159) written
- [ ] CHANGELOG updated
- [ ] CLAUDE.md SDK Roadmap row #4 → ✅ DONE
- [ ] **Dogfood QA PASS** — `/dogfood full` ≥32/36 (SKIPs count as PASS)
- [ ] **Runtime-metric proof** — `context_files_truncated` counter observed non-zero in a real workload (synthetic 50k-char AGENTS.md)
- [ ] Backward compat: `examples/telegram-pro` runs unchanged after upgrade
- [ ] **EC-E grep gate:** `grep "name=\"[A-Za-z]*\\.md@/" <prompt-trace>` returns ZERO matches (no absolute paths in `<source name>` attribute)

## Final Phase: Dogfood QA (MANDATORY)

### Execution

Run `node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id 7528967933` against telegram-pro with:
- `AGENTS.md` + `CLAUDE.md` present in `examples/telegram-pro/`
- `bot-readme.md` preserved in `examples/telegram-pro/.theokit/context/`

### Acceptance Criteria

- [ ] Health: ≥32/36 PASS (1 new scenario `/context`)
- [ ] Zero CRITICAL issues introduced by this plan
- [ ] Zero HIGH issues in `/context` command path
- [ ] Pre-existing flakes acknowledged in evidence snapshot, NOT blocking

### If Dogfood Fails

1. Identify root cause (loader bug vs harness flake).
2. Fix plan-caused issues; re-run dogfood.
3. Pre-existing issues logged, not blocking.
