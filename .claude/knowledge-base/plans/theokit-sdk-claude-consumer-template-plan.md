# Plan: TheoKit SDK — .claude/ Consumer Template

> **Version 1.1** — Ships a complete `.claude/` configuration template for consumers of `@theokit/sdk`, distributed via `npx @theokit/sdk init-claude` CLI + docs bundled in `node_modules`. Includes 15 domain-specific passive skills with **domain-scoped `paths:` patterns** (EC-3 fix), convention rules, AGENTS.md (cross-agent), and CLAUDE.md (~150 lines) so that any AI coding tool becomes a TheoKit-specialized copilot without internet access. v1.1 absorbs 3 MUST FIX + 3 SHOULD TEST from edge-case review 2026-06-12.

## Goal

> "Ship a `.claude/` consumer template with 15 passive domain skills, convention rules, AGENTS.md, and CLAUDE.md in `@theokit/sdk`, measured by `npx @theokit/sdk init-claude` scaffolding a working `.claude/` directory that Claude Code loads without errors and injects TheoKit knowledge when editing `*.ts` files."

## Context

The `/grill-me` session on 2026-06-12 (`knowledge-base/grills/theocode-claude-config-grill.md`) resolved 8 decisions: (1) target = consumers of `@theokit/sdk`; (2) distribution = CLI scaffold + bundled docs; (3) all 15 SDK domains covered; (4) passive skills via `paths:` frontmatter; (5) include convention rules; (6) CLAUDE.md substancial ~150 lines; (7) generate both AGENTS.md + CLAUDE.md; (8) source inside `packages/sdk/`.

The research (2026-06-12) identified Next.js 16.2 as the gold standard: `create-next-app` generates `AGENTS.md` + `CLAUDE.md`, docs bundled in `node_modules/next/dist/docs/`. The TheoKit SDK already has `docs.md` (3049 lines, canonical API contract) and `docs/` (site with guides, concepts, reference). These are the source material for the bundled AI docs.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/package.json` | ~200 | `5e780ac` (2026-06-11) | Package manifest with exports, bin, files | Preserve existing bin entries, exports map, files array |
| `packages/sdk/bin/init-claude.mjs` (NEW) | 0 | — | CLI scaffold command | — |
| `packages/sdk/claude-template/CLAUDE.md` (NEW) | 0 | — | Template CLAUDE.md for consumers | — |
| `packages/sdk/claude-template/AGENTS.md` (NEW) | 0 | — | Cross-agent instruction file | — |
| `packages/sdk/claude-template/settings.json` (NEW) | 0 | — | Template settings for consumers | — |
| `packages/sdk/claude-template/rules/theokit-conventions.md` (NEW) | 0 | — | Hard convention rules | — |
| `packages/sdk/claude-template/skills/theokit-agent-core/SKILL.md` (NEW) | 0 | — | Agent Core domain skill | — |
| `packages/sdk/claude-template/skills/theokit-tools/SKILL.md` (NEW) | 0 | — | Tools domain skill | — |
| `packages/sdk/claude-template/skills/theokit-memory/SKILL.md` (NEW) | 0 | — | Memory domain skill | — |
| `packages/sdk/claude-template/skills/theokit-di/SKILL.md` (NEW) | 0 | — | DI Container domain skill | — |
| `packages/sdk/claude-template/skills/theokit-di-agent/SKILL.md` (NEW) | 0 | — | DI-Agent Decorators domain skill | — |
| `packages/sdk/claude-template/skills/theokit-gateways/SKILL.md` (NEW) | 0 | — | Gateways domain skill | — |
| `packages/sdk/claude-template/skills/theokit-rag/SKILL.md` (NEW) | 0 | — | RAG domain skill | — |
| `packages/sdk/claude-template/skills/theokit-workflows/SKILL.md` (NEW) | 0 | — | Workflows domain skill | — |
| `packages/sdk/claude-template/skills/theokit-eval/SKILL.md` (NEW) | 0 | — | Eval domain skill | — |
| `packages/sdk/claude-template/skills/theokit-cron/SKILL.md` (NEW) | 0 | — | Cron/Jobs domain skill | — |
| `packages/sdk/claude-template/skills/theokit-subscriptions/SKILL.md` (NEW) | 0 | — | Subscriptions domain skill | — |
| `packages/sdk/claude-template/skills/theokit-errors/SKILL.md` (NEW) | 0 | — | Errors domain skill | — |
| `packages/sdk/claude-template/skills/theokit-config/SKILL.md` (NEW) | 0 | — | Config domain skill | — |
| `packages/sdk/claude-template/skills/theokit-streaming/SKILL.md` (NEW) | 0 | — | Streaming domain skill | — |
| `packages/sdk/claude-template/skills/theokit-budget/SKILL.md` (NEW) | 0 | — | Budget domain skill | — |
| `packages/sdk/scripts/check-claude-template-drift.ts` (NEW) | 0 | — | CI drift check: exports vs AGENTS.md import map (EC-2) | — |
| `docs.md` | 3049 | `b70747b` (2026-06-03) | Canonical API contract | Read-only source material |
| `docs/` | varies | `d828e9d` (2026-06-09) | Documentation site (guides, concepts, reference) | Read-only source material |
| `CHANGELOG.md` | varies | `df966e6` (2026-06-12) | Workspace changelog | Add entries under [Unreleased] |

### Current callers / dependents

- **`packages/sdk/bin/`** — currently has `theokit-migrate-config.mjs` and `theokit-migrate-memory.mjs`. Adding `init-claude.mjs` is additive.
- **`packages/sdk/package.json` `"bin"`** — currently maps 2 commands. Adding `theokit-init-claude` is additive.
- **`packages/sdk/package.json` `"files"`** — currently `["dist", "bin", "README.md", "CHANGELOG.md", "LICENSE"]`. Must add `"claude-template"` to include templates in npm publish.
- **`docs.md`** — canonical API contract. Read-only for this plan; skills extract content from it.
- **`docs/guides/*.md`** — guides for memory, cron, hooks, MCP, etc. Read-only; skills reference these.

### Domain glossary

- **Passive skill** — a SKILL.md with `user-invocable: false` that Claude auto-loads via `paths:` frontmatter when editing matching files
- **AGENTS.md** — cross-agent instruction file read natively by Codex, Cursor, Copilot, Windsurf, Zed, Gemini CLI, Aider
- **Bundled docs** — documentation files shipped inside `node_modules/@theokit/sdk/` as part of the npm package, version-matched with the SDK
- **Scaffold command** — CLI bin (`npx @theokit/sdk init-claude`) that copies template files to the consumer's project root

### Architecture boundaries affected

- **`packages/sdk` publish boundary** — adding `claude-template/` to the `files` array means these templates ship to npm. No source code is affected; this is documentation-only content.
- **No DIP crossing** — templates are static files (markdown, JSON). No imports, no runtime code.

## Prior Art & Related Work

- **Next.js 16.2** — `create-next-app` generates `AGENTS.md` + `CLAUDE.md`; docs bundled at `node_modules/next/dist/docs/`. Achieves 100% pass rate on Next.js evals vs 79% for skill-based retrieval. (Source: research session 2026-06-12)
- **Vercel AI SDK** — ships `skills/use-ai-sdk/SKILL.md` with `references/` for on-demand docs. (Source: research session 2026-06-12)
- **Anthropic official guidance** — `code.claude.com/docs/en/best-practices`: <200 lines CLAUDE.md, use hooks for 100% enforcement vs CLAUDE.md ~70% adherence. (Source: research session 2026-06-12)
- **Grill output** — `knowledge-base/grills/theocode-claude-config-grill.md` (8 decisions resolved)

## Objective

- [ ] Verify `npx @theokit/sdk init-claude` scaffolds `.claude/` in consumer project
- [ ] Verify 15 passive domain skills load via `paths:` when editing relevant files
- [ ] Verify AGENTS.md is generated (cross-agent compatible)
- [ ] Verify CLAUDE.md is generated (~150 lines with API quick reference)
- [ ] Verify `rules/theokit-conventions.md` enforces SDK conventions
- [ ] Verify `settings.json` has safe permission defaults
- [ ] Verify `claude-template/` is included in npm publish (`npm pack --dry-run`)

## ADRs

### D1 — Templates shipped as static files in `claude-template/`, not generated code

**Decision:** All template files (CLAUDE.md, AGENTS.md, skills, rules, settings.json) are static markdown/JSON files in `packages/sdk/claude-template/`. The `init-claude` CLI copies them verbatim.

**Rationale:** Per KISS — static files are inspectable, diffable, and require zero build step. The Next.js pattern uses generated files with comment markers, but our template is simpler (no framework-managed sections to protect). Per YAGNI — we don't need dynamic generation until proven otherwise.

**Alternatives considered:**
- **(A) Template engine (Handlebars/EJS)** — rejected: adds a dependency for placeholder substitution we don't need. The only project-specific value is the project name in CLAUDE.md, which the consumer edits manually.

**Consequences:** Consumer must manually edit CLAUDE.md to add project-specific details (build commands, structure). This is intentional — the template provides SDK knowledge, the consumer provides project knowledge.

### D2 — Skills use `user-invocable: false` with `paths:` scope

**Decision:** All 15 domain skills set `user-invocable: false` and use `paths:` frontmatter to auto-inject when Claude edits files matching the domain.

**Rationale:** Per grill Q4 — consumer chose passive injection. Skills load silently when relevant, saving the consumer from learning 15 slash commands. Claude Code's `paths:` matching ensures token cost only when the domain is active.

**Alternatives considered:**
- **(A) Explicit skills (`user-invocable: true`)** — rejected by consumer preference. Would require consumers to learn `/theokit-memory`, `/theokit-agent-core`, etc.

**Consequences:** Skills can't be invoked explicitly. If a consumer wants to read TheoKit docs without editing a file, they read CLAUDE.md or the bundled docs directly.

### D3 — AGENTS.md as canonical, CLAUDE.md imports via `@AGENTS.md`

**Decision:** AGENTS.md contains the universal API reference + conventions. CLAUDE.md starts with `@AGENTS.md` import and adds Claude-specific sections (skill directory, settings reference).

**Rationale:** Per industry pattern (Next.js, OpenAI, Mastra) — AGENTS.md is read by 7+ AI tools natively. Maximizes reach without maintaining two copies of the same content. Per DRY — single source of truth for API docs.

**Alternatives considered:**
- **(A) CLAUDE.md only** — rejected: leaves Cursor/Copilot/Codex users without guidance.
- **(B) Duplicate content in both** — rejected: DRY violation; content will drift.

**Consequences:** Consumers using non-Claude tools get AGENTS.md automatically. Claude users get AGENTS.md + Claude-specific extensions.

### D4 — CLI bin name `theokit-init-claude` added to existing `bin` field

**Decision:** Add `"theokit-init-claude": "./bin/init-claude.mjs"` to the existing `bin` field in `packages/sdk/package.json`. Consumer runs `npx @theokit/sdk init-claude` or `npx theokit-init-claude`.

**Rationale:** Follows the existing pattern (2 bins already exist). No new package needed. Per grill Q8 — everything in `packages/sdk/`.

**Alternatives considered:**
- **(A) Separate `@theokit/claude-config` package** — rejected: extra package to maintain, consumer must install separately, version mismatch risk.

**Consequences:** `init-claude.mjs` ships with every `@theokit/sdk` install. Negligible size impact (~2KB script).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| 15 skill files + templates add ~50KB to npm package size | Low | Markdown is compressible; negligible vs dist/ bundle. Monitor with `npm pack --dry-run` | Phase 1 |
| Skills content becomes stale as SDK API evolves | Medium | Skills source from `docs.md` (canonical contract). Add a `docs:drift` check that flags skills with stale API references | Phase 3 |
| Passive skills may inject unwanted context in large projects | Low | Each skill is scoped to specific `paths:` patterns. Consumer can delete skills they don't use | D2 |
| `init-claude` overwrites existing `.claude/` without warning | Medium | Script checks for existing `.claude/` and prompts before overwriting. Merge mode for existing configs | Phase 1 |

## Unresolved Questions

(none — every decision is resolved via the grill session. The 8 decisions cover distribution, format, scope, content, and location.)

## Dependency Graph

```
Phase 1 (Infrastructure) ──▶ Phase 2 (AGENTS.md + CLAUDE.md + Rules) ──▶ Phase 3 (15 Skills) ──▶ Phase 4 (Integration Validation)
```

All phases are sequential — Phase 2 needs the directory structure from Phase 1; Phase 3 needs the CLAUDE.md that references skills; Phase 4 validates everything.

---

## Phase 1: Infrastructure

**Objective:** Create the `claude-template/` directory structure, the `init-claude.mjs` CLI script, and wire it into `package.json`.

### T1.1 — Create `init-claude.mjs` CLI scaffold script

#### Objective
Create the CLI bin that copies `claude-template/` to the consumer's project root as `.claude/`, plus generates `AGENTS.md` and `CLAUDE.md` at the root.

#### Why this step
1. **What:** Create `packages/sdk/bin/init-claude.mjs` — a Node.js script that copies template files to `process.cwd()`.
2. **Why now:** This is the distribution mechanism (grill Q2). All subsequent phases create content that this script distributes. Without the script, the templates are inaccessible to consumers.

#### Evidence
- `packages/sdk/bin/` already has 2 scripts (`theokit-migrate-config.mjs`, `theokit-migrate-memory.mjs`) — proven pattern
- `package.json` `"bin"` field already maps 2 entries — additive change
- `package.json` `"files"` array needs `"claude-template"` added

#### Files to edit
```
packages/sdk/bin/init-claude.mjs (NEW) — CLI scaffold script
packages/sdk/package.json — add bin entry + files entry
```

#### Deep file dependency analysis
- `packages/sdk/bin/init-claude.mjs`: new file. Uses only Node.js built-ins (`fs`, `path`, `process`). No SDK imports needed — pure file copy.
- `packages/sdk/package.json`: add `"theokit-init-claude"` to `"bin"`, add `"claude-template"` to `"files"`. Both additive; no existing entries change.

#### Deep Dives

The script must:
1. **Check Node version >= 22.12** — exit with clear error if too old (EC-1 fix)
2. Resolve source dir: `path.join(import.meta.dirname, '../claude-template/')`
3. Resolve target: `path.join(process.cwd(), '.claude/')`
4. Check if `.claude/` exists — if yes, warn and exit (or accept `--force`)
5. **Check if `AGENTS.md` / `CLAUDE.md` exist at root** — warn independently of `.claude/` (EC-4 fix)
6. Copy `claude-template/dot-claude/` → `.claude/` recursively
7. Copy `claude-template/AGENTS.md` → `./AGENTS.md` at project root
8. Copy `claude-template/CLAUDE.md` → `./CLAUDE.md` at project root
9. Print success message with next steps

#### Pseudo-code / Signatures

```javascript
#!/usr/bin/env node
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

// EC-1: Node version guard (matches SDK engines.node)
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error("@theokit/sdk requires Node >= 22.12.0. Current: " + process.version);
  process.exit(1);
}

// EC-5: import.meta.dirname available since Node 21.2 (guarded by EC-1)
const templateDir = join(import.meta.dirname, "../claude-template");
const cwd = process.cwd();
const targetDir = join(cwd, ".claude");
const force = process.argv.includes("--force");

// EC-4: Check .claude/, AGENTS.md, CLAUDE.md independently
const conflicts = [];
if (existsSync(targetDir)) conflicts.push(".claude/");
if (existsSync(join(cwd, "AGENTS.md"))) conflicts.push("AGENTS.md");
if (existsSync(join(cwd, "CLAUDE.md"))) conflicts.push("CLAUDE.md");

if (conflicts.length > 0 && !force) {
  console.error(`Already exists: ${conflicts.join(", ")}. Use --force to overwrite.`);
  process.exit(1);
}

cpSync(join(templateDir, "dot-claude"), targetDir, { recursive: true });
cpSync(join(templateDir, "AGENTS.md"), join(cwd, "AGENTS.md"));
cpSync(join(templateDir, "CLAUDE.md"), join(cwd, "CLAUDE.md"));

console.log("Created .claude/ with TheoKit SDK configuration (15 domain skills).");
console.log("Created AGENTS.md (cross-agent) and CLAUDE.md (Claude Code).");
console.log("\nNext: open Claude Code and start building with TheoKit.");
```

#### Tasks
1. Create `packages/sdk/bin/init-claude.mjs` with file copy logic
2. Add `"theokit-init-claude": "./bin/init-claude.mjs"` to `package.json` `"bin"`
3. Add `"claude-template"` to `package.json` `"files"` array
4. Create empty directory structure: `packages/sdk/claude-template/{dot-claude/{rules,skills},AGENTS.md,CLAUDE.md}`

#### TDD
```
RED:     test_init_claude_creates_dot_claude_dir() — run script in temp dir, assert .claude/ exists
RED:     test_init_claude_creates_agents_md() — assert AGENTS.md at project root
RED:     test_init_claude_creates_claude_md() — assert CLAUDE.md at project root
RED:     test_init_claude_refuses_overwrite_without_force() — assert exit code 1 when .claude/ exists
RED:     test_init_claude_refuses_when_agents_md_exists() — assert exit code 1 when only AGENTS.md exists (EC-4)
RED:     test_init_claude_force_overwrites() — assert success with --force when .claude/ exists
RED:     test_init_claude_copies_skills_dir() — assert .claude/skills/ has 15 subdirectories
RED:     test_init_claude_copies_rules() — assert .claude/rules/theokit-conventions.md exists
RED:     test_init_claude_copies_settings() — assert .claude/settings.json exists
GREEN:   Implement init-claude.mjs
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts
```

#### Acceptance Criteria
- [ ] `node packages/sdk/bin/init-claude.mjs` in a temp dir creates `.claude/`, `AGENTS.md`, `CLAUDE.md`
- [ ] `--force` flag overwrites existing `.claude/`
- [ ] Without `--force`, existing `.claude/` causes exit code 1
- [ ] `npm pack --dry-run` in `packages/sdk/` includes `claude-template/` directory

#### DoD
- [ ] All tests passing — `pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts`
- [ ] Zero type errors — `pnpm --filter @theokit/sdk exec tsc --noEmit`
- [ ] File-size budget respected (init-claude.mjs ≤ 50 lines)

---

## Phase 2: AGENTS.md + CLAUDE.md + Rules

**Objective:** Create the three always-loaded files: AGENTS.md (cross-agent), CLAUDE.md (Claude-specific), and convention rules.

### T2.1 — Create AGENTS.md template

#### Objective
Write the canonical cross-agent instruction file with TheoKit SDK API reference, conventions, and patterns (~120 lines).

#### Why this step
1. **What:** Create `packages/sdk/claude-template/AGENTS.md` containing: SDK overview, import map, API quick reference (Agent, Tools, Memory, DI, Gateways, etc.), common patterns, error handling, and anti-patterns.
2. **Why now:** AGENTS.md is the canonical content (D3). CLAUDE.md imports it. Skills reference it. Everything downstream depends on this file existing.

#### Evidence
- `docs.md` (3049 lines) is the canonical API contract — source material
- `docs/guides/*.md` (12 guides) — additional source material
- `docs/concepts/*.md` (3 concepts) — additional source material

#### Files to edit
```
packages/sdk/claude-template/AGENTS.md (NEW) — cross-agent instruction file
```

#### Deep file dependency analysis
- New file. Content extracted from `docs.md` sections: Overview, Authentication, Core concepts, Creating agents, Streaming, Tools, Memory, DI, Gateways, Error handling.

#### Deep Dives

Content structure (~120 lines):
1. **Header** — "@theokit/sdk — TypeScript SDK for AI agents" (2 lines)
2. **Setup** — `npm install @theokit/sdk`, env vars, build/test commands (10 lines)
3. **Import map** — correct imports for each sub-path (15 lines)
4. **API quick reference** — Agent.create, agent.send, Run.stream, defineTool, Memory, DI, Gateways (50 lines)
5. **Common patterns** — streaming, tool definition with Zod, dispose, error handling (25 lines)
6. **Anti-patterns** — never import internal paths, never forget dispose, never use `any` for tool schemas (10 lines)
7. **Architecture** — packages overview: sdk, di, di-agent, gateway-*, react (10 lines)

#### Tasks
1. Extract API surface from `docs.md` into concise reference format
2. Write AGENTS.md following the structure above
3. Verify all import paths are correct against `package.json` exports map
4. **(EC-2)** Create `packages/sdk/scripts/check-claude-template-drift.ts` — compares `package.json` exports keys against AGENTS.md import map section, exits non-zero on mismatch. Wire into `package.json` scripts as `"docs:claude-drift"`.

#### TDD
```
RED:     test_agents_md_exists() — assert file exists in claude-template/
RED:     test_agents_md_under_150_lines() — wc -l ≤ 150
RED:     test_agents_md_has_import_map() — grep for "@theokit/sdk" import examples
RED:     test_agents_md_has_api_reference() — grep for "Agent.create" and "defineTool"
RED:     test_agents_md_no_internal_imports() — assert no "@theokit/sdk/internal" references
RED:     test_agents_md_import_map_matches_exports() — (EC-2) parse package.json exports, verify every public sub-path appears in AGENTS.md
GREEN:   Write the AGENTS.md content + drift check script
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts
```

#### Acceptance Criteria
- [ ] Run `wc -l packages/sdk/claude-template/AGENTS.md` and confirm ≤ 150
- [ ] Run `grep -c '@theokit/sdk/' packages/sdk/claude-template/AGENTS.md` and confirm ≥ 5 import examples
- [ ] Run `grep -c 'Agent.create' packages/sdk/claude-template/AGENTS.md` and confirm ≥ 1
- [ ] Run `grep -c 'defineTool' packages/sdk/claude-template/AGENTS.md` and confirm ≥ 1
- [ ] Run `grep -c '@theokit/sdk/internal' packages/sdk/claude-template/AGENTS.md` and confirm 0

#### DoD
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts` and confirm all tests passing
- [ ] Run `diff <(grep -oP '"\./[^"]+' packages/sdk/package.json | sort -u) <(grep -oP '@theokit/sdk/\S+' packages/sdk/claude-template/AGENTS.md | sed 's|@theokit/sdk/|./|' | sort -u)` and confirm no missing sub-paths (EC-2)

---

### T2.2 — Create CLAUDE.md template

#### Objective
Write the Claude-specific instruction file that imports AGENTS.md and adds Claude Code extensions (~30 extra lines beyond AGENTS.md import).

#### Why this step
1. **What:** Create `packages/sdk/claude-template/CLAUDE.md` with `@AGENTS.md` import + Claude-specific sections: available skills directory, settings reference, tips for using Claude Code with TheoKit.
2. **Why now:** CLAUDE.md is what Claude Code loads. It extends AGENTS.md per D3.

#### Files to edit
```
packages/sdk/claude-template/CLAUDE.md (NEW) — Claude Code instruction file
```

#### Tasks
1. Write CLAUDE.md with `@AGENTS.md` import directive at top
2. Add "Available Skills" section listing all 15 domain skills
3. Add "Settings" section referencing `.claude/settings.json`
4. Add "Customization" section guiding consumers to add project-specific info

#### TDD
```
RED:     test_claude_md_exists() — assert file exists
RED:     test_claude_md_imports_agents() — grep for "@AGENTS.md"
RED:     test_claude_md_lists_skills() — grep for all 15 skill directory names
GREEN:   Write CLAUDE.md content
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts
```

#### Acceptance Criteria
- [ ] Run `head -1 packages/sdk/claude-template/CLAUDE.md` and confirm it contains `@AGENTS.md`
- [ ] Run `grep -c 'theokit-' packages/sdk/claude-template/CLAUDE.md` and confirm ≥ 15 (all skill names listed)
- [ ] Run `wc -l packages/sdk/claude-template/CLAUDE.md` and confirm ≤ 60 (AGENTS.md content is imported, not duplicated)

#### DoD
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts` and confirm all tests passing

---

### T2.3 — Create convention rules

#### Objective
Create `rules/theokit-conventions.md` with hard rules Claude MUST follow when generating TheoKit code.

#### Why this step
1. **What:** Create `packages/sdk/claude-template/dot-claude/rules/theokit-conventions.md` — always-active rules (~30 lines).
2. **Why now:** Rules are always loaded (zero invocation cost) and prevent the most common mistakes. Per grill Q5.

#### Files to edit
```
packages/sdk/claude-template/dot-claude/rules/theokit-conventions.md (NEW)
```

#### Deep Dives

Rule content:
- Always use `Agent.create()`, never `new Agent()`
- Always call `agent.dispose()` or use `await using`
- Tools MUST use Zod schema for `inputSchema`
- Correct import paths: `@theokit/sdk`, `@theokit/sdk/subscription`, `@theokit/sdk/rag`, etc.
- NEVER import from `@theokit/sdk/internal/...`
- NEVER import from `@theokit/sdk/dist/...`
- Error handling: catch `TheokitAgentError` (base class), check `error.code`
- DI: use `@Injectable()` + `@Inject()`, never manual `new` for services
- Gateways: one gateway per agent, configure via `defineGateway()`

#### Tasks
1. Write rules file with hard conventions extracted from `docs.md` and `CLAUDE.md`

#### TDD
```
RED:     test_conventions_rule_exists() — assert file exists in dot-claude/rules/
RED:     test_conventions_has_import_rules() — grep for "@theokit/sdk" import guidance
RED:     test_conventions_bans_internal_imports() — grep for "NEVER import" + "internal"
GREEN:   Write the rules content
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts
```

#### Acceptance Criteria
- [ ] Run `wc -l packages/sdk/claude-template/dot-claude/rules/theokit-conventions.md` and confirm ≤ 40
- [ ] Run `grep -c '@theokit/sdk' packages/sdk/claude-template/dot-claude/rules/theokit-conventions.md` and confirm ≥ 3
- [ ] Run `grep -c 'dispose' packages/sdk/claude-template/dot-claude/rules/theokit-conventions.md` and confirm ≥ 1
- [ ] Run `grep -c 'NEVER' packages/sdk/claude-template/dot-claude/rules/theokit-conventions.md` and confirm ≥ 2

#### DoD
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts` and confirm all tests passing

---

### T2.4 — Create settings.json template

#### Objective
Create a safe-defaults `settings.json` for consumer projects.

#### Why this step
1. **What:** Create `packages/sdk/claude-template/dot-claude/settings.json` with permission allowlist for common SDK operations.
2. **Why now:** Settings complement rules — rules guide Claude's code generation, settings control which tools Claude can use without asking.

#### Files to edit
```
packages/sdk/claude-template/dot-claude/settings.json (NEW)
```

#### Deep Dives

Settings content:
- `permissions.allow`: `Bash(npm run *)`, `Bash(pnpm *)`, `Bash(npx *)`, `Read(./src/**)`, `Read(./docs/**)`, `Bash(git status)`, `Bash(git diff)`
- `permissions.deny`: `Read(.env*)`, `Read(**/.env*)`, `Bash(sudo *)`, `Bash(rm -rf *)`

#### Tasks
1. Write settings.json with safe defaults

#### TDD
```
RED:     test_settings_json_exists() — assert file exists
RED:     test_settings_json_valid() — JSON.parse succeeds
RED:     test_settings_denies_env_files() — permissions.deny includes .env pattern
GREEN:   Write settings.json
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts
```

#### Acceptance Criteria
- [ ] Run `node -e "JSON.parse(require('fs').readFileSync('packages/sdk/claude-template/dot-claude/settings.json','utf8'))"` and confirm exit 0
- [ ] Run `grep -c '\.env' packages/sdk/claude-template/dot-claude/settings.json` and confirm ≥ 1 (deny pattern)
- [ ] Run `grep -c 'npm run' packages/sdk/claude-template/dot-claude/settings.json` and confirm ≥ 1 (allow pattern)

#### DoD
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts` and confirm all tests passing

---

## Phase 3: 15 Domain Skills

**Objective:** Create all 15 passive domain skills with content extracted from `docs.md` and `docs/guides/`.

### T3.1 — Create Agent Core skill

#### Objective
Passive skill for `Agent.create()`, `agent.send()`, `Run.stream()`, `SDKMessage`, `AgentOptions`.

#### Why this step
1. **What:** Create `packages/sdk/claude-template/dot-claude/skills/theokit-agent-core/SKILL.md` with `paths: ["**/*.ts", "**/*.tsx"]` and `user-invocable: false`.
2. **Why now:** Agent Core is the highest-frequency domain — every TheoKit app creates agents. This skill is injected whenever Claude edits TypeScript files.

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-agent-core/SKILL.md (NEW)
```

#### Deep Dives

Content extracted from `docs.md` sections: Creating agents, AgentOptions, Streaming, SDKMessage types, Run lifecycle, dispose pattern, `Agent.prompt()` shorthand, `Agent.resume()`, `Agent.get()`.

Frontmatter (EC-3 fix — domain-scoped paths, not `**/*.ts`):
```yaml
---
name: theokit-agent-core
description: TheoKit SDK Agent Core — Agent.create, send, Run.stream, SDKMessage, dispose patterns
user-invocable: false
paths:
  - "**/*agent*"
  - "**/*Agent*"
  - "**/sdk.*"
---
```

**EC-3 domain-scoped `paths:` map for all 15 skills:**

| Skill | `paths:` patterns | Rationale |
|---|---|---|
| agent-core | `**/*agent*`, `**/*Agent*`, `**/sdk.*` | Matches agent files by naming convention |
| tools | `**/*tool*`, `**/*Tool*` | Matches tool definitions |
| memory | `**/*memory*`, `**/*Memory*`, `**/*embed*` | Matches memory + embedding files |
| di | `**/*container*`, `**/*inject*`, `**/*provider*`, `**/*module*` | DI patterns |
| di-agent | `**/*decorator*`, `**/*Decorator*`, `**/di-agent*` | Decorator files |
| gateways | `**/*gateway*`, `**/*Gateway*`, `**/*telegram*`, `**/*slack*`, `**/*discord*`, `**/*whatsapp*` | Gateway transports |
| rag | `**/*retriev*`, `**/*rerank*`, `**/*splitter*`, `**/*rag*` | RAG pipeline components |
| workflows | `**/*workflow*`, `**/*Workflow*`, `**/*step*` | Workflow definitions |
| eval | `**/*eval*`, `**/*Eval*`, `**/*scorer*` | Evaluation files |
| cron | `**/*cron*`, `**/*Cron*`, `**/*job*`, `**/*schedule*` | Cron/job files |
| subscriptions | `**/*subscri*`, `**/*sse*`, `**/*websocket*`, `**/*ws.*` | Subscription transports |
| errors | `**/*error*`, `**/*Error*`, `**/*exception*` | Error handling files |
| config | `**/.theokit/**`, `**/config.*`, `**/theo.config.*` | Config files |
| streaming | `**/*stream*`, `**/*Stream*`, `**/*SDKMessage*` | Streaming patterns |
| budget | `**/*budget*`, `**/*Budget*`, `**/*cost*`, `**/*token*` | Budget/cost files |

This ensures each skill fires only when Claude edits files in its domain (~200 lines per activation), not all 15 skills on every `.ts` edit (~3000 lines).

#### Tasks
1. Extract Agent Core API from `docs.md` into skill format
2. Include code examples for create, send, stream, dispose
3. Include SDKMessage type discriminants

#### TDD
```
RED:     test_agent_core_skill_exists() — assert SKILL.md exists
RED:     test_agent_core_skill_frontmatter() — parse YAML, verify user-invocable: false and paths
RED:     test_agent_core_skill_has_create_example() — grep "Agent.create"
GREEN:   Write the skill content
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts
```

#### Acceptance Criteria
- [ ] Run `head -10 packages/sdk/claude-template/dot-claude/skills/theokit-agent-core/SKILL.md` and confirm `user-invocable: false` in frontmatter
- [ ] Run `grep -c 'Agent.create' packages/sdk/claude-template/dot-claude/skills/theokit-agent-core/SKILL.md` and confirm ≥ 1
- [ ] Run `grep -c 'agent.send' packages/sdk/claude-template/dot-claude/skills/theokit-agent-core/SKILL.md` and confirm ≥ 1
- [ ] Run `wc -l packages/sdk/claude-template/dot-claude/skills/theokit-agent-core/SKILL.md` and confirm ≤ 300

#### DoD
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts` and confirm all tests passing

---

### T3.2 — Create Tools skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-tools/SKILL.md (NEW)
```

Content: `defineTool()`, `@Tool()` decorator, Zod input schema, tool execution, built-in tools reference. Paths: `["**/*tool*", "**/*Tool*"]` (EC-3).

#### TDD
```
RED:     test_tools_skill_exists()
RED:     test_tools_skill_frontmatter()
GREEN:   Write content from docs.md § defineTool + docs/guides/
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts
```

---

### T3.3 — Create Memory skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-memory/SKILL.md (NEW)
```

Content: Memory API, embedding providers, dreaming, active recall, `MemoryAdapter` interface. Paths: `["**/*memory*", "**/*Memory*", "**/*embed*"]` (EC-3).

#### TDD
```
RED:     test_memory_skill_exists()
RED:     test_memory_skill_frontmatter()
GREEN:   Write content from docs.md § Memory + docs/guides/memory.md
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts
```

---

### T3.4 — Create DI Container skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-di/SKILL.md (NEW)
```

Content: `@Injectable`, `@Inject`, `@Optional`, `@Qualifier`, `@Primary`, `Container`, scopes (SINGLETON, TRANSIENT, REQUEST), `@PostConstruct`, `@PreDestroy`. Paths: `["**/*container*", "**/*inject*", "**/*provider*", "**/*module*"]` (EC-3).

---

### T3.5 — Create DI-Agent Decorators skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-di-agent/SKILL.md (NEW)
```

Content: All 15 agentic decorators (`@Tool`, `@Workflow`, `@Eval`, `@Cron`, `@Subscription`, `@Auth`, `@Retriever`, `@Reranker`, `@TextSplitter`, `@UseSandbox`, `@SubAgent`, `@Hitl`, `@AutoSummarize`, `@InjectAgent`, `@MemoryScope`), reader helpers. Paths: `["**/*decorator*", "**/*Decorator*", "**/di-agent*"]` (EC-3).

---

### T3.6 — Create Gateways skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-gateways/SKILL.md (NEW)
```

Content: Gateway architecture, `defineGateway()`, available gateways (Telegram, Slack, Discord, WhatsApp, Teams, Email, SMS, Mattermost, LINE, Matrix), transport config. Paths: `["**/*gateway*", "**/*Gateway*", "**/*telegram*", "**/*slack*", "**/*discord*", "**/*whatsapp*"]` (EC-3).

---

### T3.7 — Create RAG skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-rag/SKILL.md (NEW)
```

Content: `VectorRetriever`, `CohereReranker`, text splitters, `@theokit/sdk/rag` sub-path. Paths: `["**/*retriev*", "**/*rerank*", "**/*splitter*", "**/*rag*"]` (EC-3).

---

### T3.8 — Create Workflows skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-workflows/SKILL.md (NEW)
```

Content: `Workflow.create()`, steps, retry policy, `workflow.run()`, `workflow.resume()`. Paths: `["**/*workflow*", "**/*Workflow*", "**/*step*"]` (EC-3).

---

### T3.9 — Create Eval skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-eval/SKILL.md (NEW)
```

Content: `Eval.create()`, scorers (`exactMatch`, `llmJudge`, `custom`), datasets, `eval.run()`. Paths: `["**/*eval*", "**/*Eval*", "**/*scorer*"]` (EC-3).

---

### T3.10 — Create Cron/Jobs skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-cron/SKILL.md (NEW)
```

Content: `Cron.create()`, schedule syntax, `@Cron()` decorator, job lifecycle. Paths: `["**/*cron*", "**/*Cron*", "**/*job*", "**/*schedule*"]` (EC-3).

---

### T3.11 — Create Subscriptions skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-subscriptions/SKILL.md (NEW)
```

Content: `defineSubscription`, SSE transport, WebSocket transport, `subscribe()`, `tracked()`, resume tokens. Paths: `["**/*subscri*", "**/*sse*", "**/*websocket*", "**/*ws.*"]` (EC-3).

---

### T3.12 — Create Errors skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-errors/SKILL.md (NEW)
```

Content: `TheokitAgentError` hierarchy, error codes, typed error handling patterns, `ConfigurationError`, `AgentRunError`, `UnsupportedRunOperationError`. Paths: `["**/*error*", "**/*Error*", "**/*exception*"]` (EC-3).

---

### T3.13 — Create Config skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-config/SKILL.md (NEW)
```

Content: `.theokit/` directory structure, `mcp.json`, `hooks.json`, env vars (`THEOKIT_API_KEY`, `THEOKIT_MODEL_ID`), config discovery order. Paths: `["**/.theokit/**", "**/config.*", "**/theo.config.*"]` (EC-3).

---

### T3.14 — Create Streaming skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-streaming/SKILL.md (NEW)
```

Content: `Run.stream()` AsyncGenerator, `SDKMessage` discriminated union types, `streamObject()`, `generateObject()`, streaming patterns. Paths: `["**/*stream*", "**/*Stream*", "**/*SDKMessage*"]` (EC-3).

---

### T3.15 — Create Budget skill

#### Files to edit
```
packages/sdk/claude-template/dot-claude/skills/theokit-budget/SKILL.md (NEW)
```

Content: Cost tracking, token budget, `@Budget()` decorator, usage reporting, `budget.remaining()`. Paths: `["**/*budget*", "**/*Budget*", "**/*cost*", "**/*token*"]` (EC-3).

---

### T3.* — TDD for all 15 skills (consolidated)

All 15 skills follow the same test pattern. One consolidated test file validates all:

```
RED:     test_all_15_skills_exist() — iterate skill dirs, assert SKILL.md exists
RED:     test_all_skills_have_correct_frontmatter() — parse YAML, verify user-invocable: false + paths
RED:     test_all_skills_have_domain_scoped_paths() — (EC-3) verify NO skill uses ["**/*.ts"] as sole path
RED:     test_all_skills_under_300_lines() — wc -l ≤ 300 each
RED:     test_no_skill_references_internal_paths() — grep -v "@theokit/sdk/internal"
RED:     test_all_skills_frontmatter_no_trailing_whitespace() — (EC-6) parse YAML, verify no trailing whitespace in values
GREEN:   Write all 15 skills
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts
```

#### Acceptance Criteria for all skills
- [ ] Run `for d in packages/sdk/claude-template/dot-claude/skills/theokit-*/; do grep -q 'user-invocable: false' "$d/SKILL.md" || echo "FAIL: $d"; done` and confirm zero FAIL output
- [ ] Run `for d in packages/sdk/claude-template/dot-claude/skills/theokit-*/; do grep -q 'paths:' "$d/SKILL.md" || echo "FAIL: $d"; done` and confirm zero FAIL output
- [ ] Run `for d in packages/sdk/claude-template/dot-claude/skills/theokit-*/; do grep -q '\*\*/\*\.ts' "$d/SKILL.md" && echo "EC3-FAIL: $d"; done` and confirm zero EC3-FAIL output (no skill uses `**/*.ts` as sole path)
- [ ] Run `wc -l packages/sdk/claude-template/dot-claude/skills/theokit-*/SKILL.md` and confirm each ≤ 300
- [ ] Run `grep -rl '@theokit/sdk/internal' packages/sdk/claude-template/dot-claude/skills/` and confirm zero matches
- [ ] Run `ls -d packages/sdk/claude-template/dot-claude/skills/theokit-*/ | wc -l` and confirm 15

#### DoD
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts` and confirm all tests passing

---

## Phase 4: Integration Validation (MANDATORY)

**Objective:** Validate the complete template works end-to-end.

### Execution

```bash
# 1. Scaffold in a temp directory
TMPDIR=$(mktemp -d)
cd "$TMPDIR"
npm init -y
node /path/to/packages/sdk/bin/init-claude.mjs

# 2. Verify structure
test -f AGENTS.md
test -f CLAUDE.md
test -d .claude
test -d .claude/skills
test -d .claude/rules
test -f .claude/settings.json
ls .claude/skills/ | wc -l  # should be 15

# 3. Verify npm pack includes templates
cd /path/to/packages/sdk
npm pack --dry-run 2>&1 | grep claude-template

# 4. Run full test suite
pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts

# 5. Typecheck
pnpm --filter @theokit/sdk exec tsc --noEmit

# 6. Lint
pnpm -w run check
```

### Acceptance Criteria

- [ ] `init-claude.mjs` scaffolds complete `.claude/` with 15 skills, rules, settings
- [ ] `AGENTS.md` and `CLAUDE.md` generated at project root
- [ ] `npm pack --dry-run` includes `claude-template/` in tarball
- [ ] All test suites green
- [ ] Zero type errors
- [ ] Zero lint warnings
- [ ] CHANGELOG.md updated with entry under `[Unreleased] § Added`

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | CLI scaffold command | T1.1 | `init-claude.mjs` bin script |
| 2 | package.json wiring (bin + files) | T1.1 | Additive changes to bin and files |
| 3 | AGENTS.md (cross-agent) | T2.1 | ~120 lines API reference |
| 4 | CLAUDE.md (Claude-specific) | T2.2 | @AGENTS.md import + skill directory |
| 5 | Convention rules | T2.3 | `packages/sdk/claude-template/dot-claude/rules/theokit-conventions.md` (NEW) |
| 6 | Settings defaults | T2.4 | settings.json with safe permissions |
| 7 | Agent Core skill | T3.1 | Passive skill for Agent API |
| 8 | Tools skill | T3.2 | Passive skill for defineTool |
| 9 | Memory skill | T3.3 | Passive skill for Memory API |
| 10 | DI Container skill | T3.4 | Passive skill for DI |
| 11 | DI-Agent Decorators skill | T3.5 | Passive skill for 15 decorators |
| 12 | Gateways skill | T3.6 | Passive skill for 10 gateways |
| 13 | RAG skill | T3.7 | Passive skill for retrievers/rerankers |
| 14 | Workflows skill | T3.8 | Passive skill for Workflow API |
| 15 | Eval skill | T3.9 | Passive skill for Eval API |
| 16 | Cron/Jobs skill | T3.10 | Passive skill for Cron API |
| 17 | Subscriptions skill | T3.11 | Passive skill for SSE/WS |
| 18 | Errors skill | T3.12 | Passive skill for error hierarchy |
| 19 | Config skill | T3.13 | Passive skill for .theokit/ config |
| 20 | Streaming skill | T3.14 | Passive skill for SDKMessage |
| 21 | Budget skill | T3.15 | Passive skill for cost tracking |
| 22 | npm publish includes templates | T1.1 | `"files"` array updated |
| 23 | (EC-1) Node version guard in CLI | T1.1 | Version check at script start |
| 24 | (EC-2) Drift check: exports vs AGENTS.md | T2.1 | `check-claude-template-drift.ts` CI script |
| 25 | (EC-3) Domain-scoped `paths:` per skill | T3.1-T3.15 | Each skill has unique path patterns per EC-3 table |
| 26 | (EC-4) Warn on existing AGENTS.md/CLAUDE.md | T1.1 | Independent conflict check |
| 27 | (EC-6) YAML frontmatter whitespace validation | T3.1-T3.15 | `test_all_skills_frontmatter_no_trailing_whitespace()` in T3.* TDD |

**Coverage: 27/27 gaps covered (100%)**

## Global Definition of Done

- [ ] Verify all phases completed
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run tests/init-claude.test.ts` and confirm all tests passing
- [ ] Run `pnpm --filter @theokit/sdk exec tsc --noEmit` and confirm zero type errors
- [ ] Run `pnpm -w run check` and confirm zero lint warnings
- [ ] Verify `npm pack --dry-run` includes `claude-template/` in output
- [ ] Verify `npx @theokit/sdk init-claude` works in a clean temp directory
- [ ] Verify CHANGELOG.md updated under `[Unreleased] § Added`
- [ ] Confirm plan archived to `knowledge-base/plans/completed/` after merge
