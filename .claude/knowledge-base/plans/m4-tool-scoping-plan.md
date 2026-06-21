---
slug: m4-tool-scoping
milestone_id: M4
created_at: 2026-06-21
goal: Add AgentDefinition.tools?: string[] (+ subagent frontmatter parse) and a subagentToolWhitelist/withSubagentToolScope bridge that enforces it via the existing withToolWhitelist (NOT PermissionEngine), measured by tests/subagent-tool-scope.test.ts passing green (a read-only tools:[read_file] sub-agent has write/shell vetoed by the same checkToolWhitelist the loop runs).
---

# Plan: M4-6 — tool scoping per `AgentDefinition`

> **Version 1.1** (edge-case-plan absorbed: EC-1 parse-trims-empties folded into T1.1 TDD; EC-2 empty-unscoped already in T1.2; EC-3 nesting-shadows + EC-4 exact-case-match documented) — Close roadmap gap M4-6: today a sub-agent's tool access is only "prompt-soft" — `AgentDefinition` (`.theokit/agents/*.md` or inline) cannot DECLARE a tool whitelist, and the prompt is the only thing nudging it. M4-6 (1) adds `tools?: string[]` to `AgentDefinition` + parses a `tools:` frontmatter field, and (2) ships `subagentToolWhitelist(definition)` + `withSubagentToolScope(definition, fn)` — a bridge that turns a definition's `tools` into the `Set<string>` the EXISTING `withToolWhitelist`/`checkToolWhitelist` enforcement (the same one `Agent.fork`'s `allowedTools` uses, vetoing non-whitelisted tools at dispatch with exit 126) consumes. The proof: a `tools: ["read_file"]` sub-agent provably has `write_file`/`shell_exec` vetoed by the exact `checkToolWhitelist` the agent loop runs — enforcement, NOT PermissionEngine.

## Goal

> "Enable a sub-agent to declare a tool whitelist (`AgentDefinition.tools`) enforced via the existing `withToolWhitelist` so a read-only sub-agent provably cannot Write/Bash, measured by `pnpm --filter @theokit/sdk exec vitest run tests/subagent-tool-scope.test.ts` reporting all tests passed (write/shell vetoed, read_file allowed under a `tools:[read_file]` scope)."

## Context

Roadmap gap M4-6 (`docs/gap-audit/ROADMAP.md:148`, med sev, size M, Tema A — "hoje só prompt soft"). `AgentDefinition` (`packages/sdk/src/types/agent.ts:76`) has `{ description, prompt, model?, mcpServers? }` — no `tools`. The subagent loader (`internal/runtime/skills/subagents-loader.ts:52`) parses `description`/`model` from frontmatter but ignores `tools`. The SDK ALREADY has the enforcement: `withToolWhitelist(Set, fn)` + `checkToolWhitelist(name)` (`internal/runtime/concurrency/async-local-storage.ts`), wired at `internal/agent-loop/tool-dispatch.ts:138` (`vetoFromForkWhitelist` → blocks a non-whitelisted call with a `tool_result` "Tool blocked by fork whitelist" + exit 126). `Agent.fork({ allowedTools })` (`types/fork.ts:18`) uses it today. M4-6 makes `AgentDefinition.tools` a first-class declaration that feeds that same enforcement — the missing piece between "declare" and "enforce". Per the gap: enforcement via `withToolWhitelist`, explicitly NOT `PermissionEngine` (which is a policy/allow-deny-ask engine, the wrong shape for a closed name whitelist). Zero new dependencies.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/types/agent.ts` | ~600 | (types) | public type contract incl. `AgentDefinition` | additive optional `tools?` only — existing `{description,prompt}` definitions stay valid |
| `packages/sdk/src/internal/runtime/skills/subagents-loader.ts` | ~95 | (sdk) | `.theokit/agents/*.md` loader + inline merge | `description`/`model`/inline-override behavior unchanged; `tools` parse is additive |
| `packages/sdk/src/internal/runtime/skills/subagent-tool-scope.ts` (NEW) | 0 | — | `subagentToolWhitelist` + `withSubagentToolScope` bridge | — |
| `packages/sdk/src/index.ts` | (barrel) | — | public barrel | additive exports only |
| `packages/sdk/tests/subagent-tool-scope.test.ts` (NEW) | 0 | — | unit + enforcement-proof tests — RED first | — |
| `packages/sdk/tests/contract/subagents.contract.test.ts` | ~70 | (sdk) | subagent loader contract | existing assertions stay green; ADD a `tools`-frontmatter parse assertion |
| `CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive `Added` entry |
| `docs.md` | (contract) | — | public API contract | additive `AgentDefinition.tools` + scope note |

### Current callers / dependents

- **Symbol:** `AgentDefinition` (`types/agent.ts:76`)
  - Callers (production): `subagents-loader.ts`, `local-agent.ts` (`resolvedSubagents`), `local-run.ts`/`local-agent-dispatch.ts` (threaded as `subagents`), `a2a/subagent.ts` (sibling concept). Adding OPTIONAL `tools?` is backward-compatible — every existing `{ description, prompt }` construction still satisfies the type.
  - Callers (tests): `tests/contract/subagents.contract.test.ts`.
- **Symbol:** `withToolWhitelist`/`checkToolWhitelist` (`internal/runtime/concurrency/async-local-storage.ts`) — already enforced at `tool-dispatch.ts:138`; reused unchanged. `Agent.fork`'s `allowedTools` consumes it (`fork-agent.ts:105`).
- **External:** theocode-style consumers that want a read-only sub-agent (the gap's target).

### Domain glossary

- **AgentDefinition** — a sub-agent's declaration (`description`, `prompt`, optional `model`/`mcpServers`); from `.theokit/agents/*.md` frontmatter+body or inline.
- **tool whitelist** — a closed `Set<string>` of allowed tool names; a tool call whose name is not in the set is vetoed at dispatch (the fork model — inherit broadly, restrict by whitelist).
- **withToolWhitelist / checkToolWhitelist** — the AsyncLocalStorage enforcement: `withToolWhitelist(set, fn)` runs `fn` under `set`; `checkToolWhitelist(name)` (called by the loop's dispatch) returns `{allowed:false, reason}` for a name not in the active set.
- **prompt-soft scoping** — today's state: the sub-agent's allowed tools are only suggested via prose, not enforced.

### Architecture boundaries affected

Per `rules/architecture.md` §1/§2: `subagent-tool-scope.ts` is a leaf module composing the existing internal `withToolWhitelist` + the `AgentDefinition` type. `AgentDefinition.tools` is an additive field on the public type. No new DIP boundary; the enforcement primitive is reused, not reimplemented (Rule 9).

## Prior Art & Related Work

- **Baseline investigation (2026-06-21)** — Explore agent mapped: `AgentDefinition` has no `tools`; `subagents-loader.ts` ignores a `tools:` frontmatter; `withToolWhitelist`/`checkToolWhitelist` exist + are wired at `tool-dispatch.ts:138`; `Agent.fork({allowedTools})` (`fork-agent.ts:105`) is the existing real consumer of that enforcement; `.theokit/agents` subagents are surfaced to the parent prompt (soft).
- **In-repo precedent (enforcement to reuse)** — `forkAgentImpl` wraps a fork run in `withToolWhitelist(options.allowedTools, …)` (`fork-agent.ts:105`); `vetoFromForkWhitelist` blocks at dispatch (`tool-dispatch.ts:132-153`).
- **ADRs** — `knowledge-base/adrs/D111-*` (per-fork tool whitelist via AsyncLocalStorage); the `PermissionEngine` (`permission-engine.ts`) is the REJECTED alternative (policy engine, not a closed whitelist).

## Objective

- [ ] `AgentDefinition.tools?: string[]` added (optional, backward-compatible).
- [ ] The subagent loader parses a `tools:` frontmatter field (comma/space-separated → `string[]`); inline `tools` preserved.
- [ ] `subagentToolWhitelist(definition): Set<string> | undefined` returns `new Set(definition.tools)` when `tools` is a non-empty array, else `undefined` (unscoped).
- [ ] `withSubagentToolScope(definition, fn)` runs `fn` under `withToolWhitelist(whitelist, fn)` when scoped, else runs `fn` directly (parent/unscoped sub-agents unaffected).
- [ ] Enforcement is the existing `checkToolWhitelist` (NOT PermissionEngine); proven: under a `tools:["read_file"]` scope, `checkToolWhitelist("write_file")`/`("shell_exec")` are blocked and `("read_file")` allowed.
- [ ] Barrel-exported; `docs.md` + CHANGELOG + changeset.
- [ ] `tests/subagent-tool-scope.test.ts` + the loader contract assertion green; typecheck + Biome clean.

## ADRs

### D1 — `tools?: string[]` on `AgentDefinition` (name whitelist), not inline tool objects
**Decision:** `AgentDefinition.tools` is an optional array of tool NAMES (`["read_file","list_dir"]`), the whitelist of tools the sub-agent may call.
**Rationale:** matches the fork model (inherit the broad toolset, restrict by name) — the right shape for "read-only sub-agent" (it still SEES the tools but write/shell are vetoed). `Set<string>` is exactly what `withToolWhitelist`/`ForkOptions.allowedTools` consume.
**Alternatives considered:** `tools?: CustomTool[]` (the a2a `SubAgentSpec` model — give the child only those tools) — rejected for AgentDefinition: the `.theokit/agents/*.md` frontmatter is text, can't carry tool objects; and the whitelist model is what the gap ("read-only provably") needs.

### D2 — Enforce via the existing `withToolWhitelist`, NOT `PermissionEngine`
**Decision:** `withSubagentToolScope` wraps the run in the existing `withToolWhitelist(new Set(definition.tools), fn)`; the loop's `checkToolWhitelist` (`tool-dispatch.ts:138`) vetoes non-whitelisted calls.
**Rationale:** the gap explicitly says "NÃO via PermissionEngine". `PermissionEngine` is allow/deny/ask policy (regex rules) — the wrong shape for a closed name whitelist. `withToolWhitelist` is the purpose-built mechanism already wired + tested (forks). Rule 9 — reuse, don't reinvent.
**Alternatives considered:** `PermissionEngine` rules per sub-agent — rejected (over-scoped; policy engine for a Set membership); a new enforcement path — rejected (duplicates the wired dispatch veto).

### D3 — `subagentToolWhitelist` returns `undefined` for unscoped (empty/absent `tools`)
**Decision:** no `tools` (or empty array) → `undefined` → `withSubagentToolScope` runs `fn` directly (no whitelist). A non-empty `tools` → a `Set`.
**Rationale:** absent `tools` means "inherit the parent's full toolset" (unscoped) — `checkToolWhitelist` allows everything outside a scope, so passthrough preserves today's behavior. An empty `tools: []` is treated as unscoped (not "deny all") to avoid a footgun where a typo silently neuters a sub-agent — see Drawbacks/edge.
**Alternatives considered:** empty array → deny-all — rejected (surprising; a likely-accidental empty list would brick the sub-agent silently); always-scope — rejected (breaks unscoped subagents).

### D4 — Frontmatter `tools` is comma/space-separated (text schema)
**Decision:** the loader parses a `tools:` string (`"read_file, list_dir"`) into `["read_file","list_dir"]` (split on commas/whitespace, trim, drop empties).
**Rationale:** the simple-YAML frontmatter dialect is all-string (`parseFrontmatterFields`); a comma/space list mirrors how `skill-frontmatter.ts` parses `dependencies`. KISS.
**Alternatives considered:** real YAML array — rejected (the loader uses the simple-YAML dialect; adding array support is out of scope); JSON in frontmatter — rejected (awkward to author).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `.theokit/agents` subagents are surfaced to the parent prompt today (no SDK nested-execution loop in the tested path); the whitelist is enforced wherever the definition is RUN under `withSubagentToolScope` (e.g. via `Agent.fork`) | Medium | M4-6 ships the declaration + the enforcement bridge + a proof through the REAL `checkToolWhitelist`; document that a scoped sub-agent run wraps execution in `withSubagentToolScope` (the fork path already enforces `allowedTools`). The gap "prompt-soft → enforceable" is closed: the whitelist is now declarable + enforced by the same code the loop runs | SDK |
| A tool name typo in `tools` silently narrows the sub-agent | Low | the whitelist is exact-match by design (same as fork's `allowedTools`); document that names must match canonical (post-repair, lowercase) tool names; empty list → unscoped (D3) avoids the worst footgun | SDK |
| Whitelist is name-based — a sub-agent could still be given a differently-named dangerous tool | Low | this is the fork model's documented contract; the whitelist restricts the inherited set, it does not sandbox the process (heuristic guardrail, like M3-2) | SDK |
| Async-local-storage scope must propagate into the nested run | Low | `withToolWhitelist` uses `AsyncLocalStorage` which propagates across `await` (proven by the fork path); the proof test asserts `checkToolWhitelist` sees the scope | SDK |

## Unresolved Questions

(none — every decision is resolved at plan time. Name-whitelist shape (D1), enforce-via-withToolWhitelist (D2), undefined-for-unscoped (D3), frontmatter parse (D4) are locked against the existing fork enforcement + the simple-YAML loader precedent.)

## Dependencies

M4-6 introduces ZERO new dependencies — composes the existing `withToolWhitelist` enforcement + a frontmatter string split (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `withToolWhitelist`/`checkToolWhitelist` (in-repo `@internal`) | workspace | npm/TS | the wired tool-veto enforcement (same one forks use) |
| `parseSimpleYaml` / loader helpers (in-repo `@internal`) | workspace | npm/TS | frontmatter parse |

### New — to be introduced

(none — explicitly NOT `PermissionEngine`; see ADR D2.)

## Dependency Graph

```
Phase 1 (tools field + frontmatter + scope bridge) ──▶ Phase 2 (barrel + docs) ──▶ Phase 3 (integration validation)
```

Sequential.

---

## Phase 1: `tools` field + frontmatter + scope bridge

**Objective:** declare the whitelist + bridge it to the existing enforcement, with TDD.

### T1.1 — `AgentDefinition.tools?` + frontmatter parse

#### Objective
The declaration: type field + loader parsing.

#### Why this step (action + reasoning)
1. **What this step does** — adds `tools?: string[]` to `AgentDefinition` (`types/agent.ts`) and parses a `tools:` frontmatter field in `subagents-loader.ts` (comma/space → `string[]`); inline `tools` flow through unchanged.
2. **Why it is necessary now** — the whitelist must be declarable before it can be enforced; doing it first lets the loader contract test prove parsing.

#### Evidence
`AgentDefinition` at `types/agent.ts:76` (no `tools`); `parseSubagentMarkdown` at `subagents-loader.ts:52` builds the definition from `fields.description`/`fields.model` only.

#### Files to edit
```
packages/sdk/src/types/agent.ts — add tools?: string[] to AgentDefinition
packages/sdk/src/internal/runtime/skills/subagents-loader.ts — parse fields.tools (comma/space → string[])
packages/sdk/tests/contract/subagents.contract.test.ts — assert a .theokit/agents/*.md with `tools:` frontmatter loads definition.tools
```

#### Deep file dependency analysis
- `AgentDefinition` gains an optional field — every existing construction stays valid (backward-compat). `parseSubagentMarkdown` sets `definition.tools` only when `fields.tools` is present + non-empty.

#### Deep Dives
- Parse: `tools = fields.tools?.split(/[\s,]+/).map(t=>t.trim()).filter(Boolean)`; set only if length > 0.
- Edge: no `tools:` → `definition.tools` undefined. Inline definition's `tools` array passes through (loader merge).

#### Tasks
1. Add the type field.
2. Parse `tools` in the loader; add a fixture subagent with `tools:` frontmatter + a contract assertion.

#### TDD
```
RED:     subagent_frontmatter_tools_parsed() — a .theokit/agents/scoped.md with `tools: read_file, list_dir` → loaded definition.tools === ["read_file","list_dir"]
RED:     subagent_without_tools_has_undefined() — a subagent with no tools frontmatter → definition.tools undefined
RED:     subagent_tools_frontmatter_trims_and_drops_empties() — (EC-1) `read_file,  list_dir ,` → exactly ["read_file","list_dir"]
GREEN:   add field + loader parse
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/contract/subagents.contract.test.ts
```

#### Acceptance Criteria
- [ ] Loader parse + existing contract tests pass — `pnpm --filter @theokit/sdk exec vitest run tests/contract/subagents.contract.test.ts` reports all tests passed.
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check src/internal/runtime/skills/subagents-loader.ts src/types/agent.ts` reports 0 warnings.

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/contract/subagents.contract.test.ts` exits 0
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck` exits 0

### T1.2 — `subagentToolWhitelist` + `withSubagentToolScope` (enforce via withToolWhitelist)

#### Objective
Bridge the declaration to the existing enforcement, with a proof through the real `checkToolWhitelist`.

#### Why this step (action + reasoning)
1. **What this step does** — adds `packages/sdk/src/internal/runtime/skills/subagent-tool-scope.ts` with `subagentToolWhitelist(definition)` + `withSubagentToolScope(definition, fn)` wrapping `fn` in the existing `withToolWhitelist` when scoped.
2. **Why it is necessary now** — this is the "prompt-soft → enforceable" bridge; proving it through the EXACT `checkToolWhitelist` the loop runs (`tool-dispatch.ts:138`) is the gap's "read-only provably" requirement.

#### Evidence
`withToolWhitelist(set, fn)` + `checkToolWhitelist(name)` at `async-local-storage.ts`; the loop vetoes via `checkToolWhitelist` at `tool-dispatch.ts:138`. `fork-agent.ts:105` mirrors the wrap.

#### Files to edit
```
packages/sdk/src/internal/runtime/skills/subagent-tool-scope.ts — NEW: subagentToolWhitelist + withSubagentToolScope
packages/sdk/tests/subagent-tool-scope.test.ts — NEW: RED tests (whitelist from tools; scope vetoes write/shell, allows read_file; unscoped passthrough)
```

#### Deep file dependency analysis
- Imports `withToolWhitelist`/`checkToolWhitelist` from `../concurrency/async-local-storage.js` + `AgentDefinition` type. Pure composition.

#### Deep Dives
- `subagentToolWhitelist(def)`: `Array.isArray(def.tools) && def.tools.length > 0 ? new Set(def.tools) : undefined`.
- `withSubagentToolScope(def, fn)`: `const wl = subagentToolWhitelist(def); return wl ? withToolWhitelist(wl, fn) : fn();`.
- Proof: inside `withSubagentToolScope({tools:["read_file"], …}, async () => { … })`, `checkToolWhitelist("read_file").allowed === true`, `checkToolWhitelist("write_file").allowed === false`, `checkToolWhitelist("shell_exec").allowed === false`. Outside any scope (unscoped def) → `checkToolWhitelist("write_file").allowed === true` (passthrough).

#### Pseudo-code / Signatures
```pseudocode
function subagentToolWhitelist(def: AgentDefinition): Set<string> | undefined
  return (Array.isArray(def.tools) && def.tools.length > 0) ? new Set(def.tools) : undefined
async function withSubagentToolScope<T>(def, fn: () => Promise<T>): Promise<T>
  const wl = subagentToolWhitelist(def)
  return wl ? withToolWhitelist(wl, fn) : fn()
# Example (proof): await withSubagentToolScope({description:"",prompt:"",tools:["read_file"]}, async () => {
#   checkToolWhitelist("read_file").allowed === true; checkToolWhitelist("write_file").allowed === false })
```

#### Tasks
1. Write RED tests (whitelist derivation; scope vetoes write/shell + allows read_file via real checkToolWhitelist; unscoped → passthrough; empty tools → unscoped).
2. Implement `subagent-tool-scope.ts`.

#### TDD
```
RED:     subagentToolWhitelist_from_tools() — {tools:["a","b"]} → Set{a,b}; {} → undefined; {tools:[]} → undefined
RED:     scope_vetoes_non_whitelisted_via_real_enforcement() — inside withSubagentToolScope({tools:["read_file"]}): checkToolWhitelist("write_file"/"shell_exec").allowed false, "read_file" true
RED:     unscoped_definition_is_passthrough() — withSubagentToolScope({no tools}): checkToolWhitelist("write_file").allowed true (parent unaffected)
GREEN:   Implement subagent-tool-scope.ts
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/subagent-tool-scope.test.ts
```

#### Acceptance Criteria
- [ ] All RED tests pass — `pnpm --filter @theokit/sdk exec vitest run tests/subagent-tool-scope.test.ts` reports all tests passed.
- [ ] Enforcement is `checkToolWhitelist` (the loop's dispatch veto), NOT PermissionEngine (no `permission-engine` import).
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check src/internal/runtime/skills/subagent-tool-scope.ts` reports 0 warnings.

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/subagent-tool-scope.test.ts` exits 0
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck` exits 0

---

## Phase 2: Barrel + docs

**Objective:** export the bridge, document, changelog.

### T2.1 — Barrel export + docs/changelog + wiring test

#### Objective
Public exports + docs + an end-to-end proof through a built-tool name.

#### Why this step (action + reasoning)
1. **What this step does** — barrel-exports `subagentToolWhitelist` + `withSubagentToolScope`; documents `AgentDefinition.tools` + the scope; CHANGELOG + changeset; adds a wiring test using a REAL built-in tool name (e.g. `createWriteFileTool().name`) to prove a read-only sub-agent's scope vetoes it.
2. **Why it is necessary now** — closes the loop: a consumer running a sub-agent wraps it in `withSubagentToolScope` (public) and the real tool's name is vetoed — the "read-only sub-agent cannot Write/Bash" proof on a concrete tool.

#### Evidence
sdk barrel `src/index.ts`; the scope reuses the wired enforcement. Real tool names come from `@theokit/sdk-tools` factories (e.g. write/shell tools).

#### Files to edit
```
packages/sdk/src/index.ts — export subagentToolWhitelist + withSubagentToolScope
packages/sdk/tests/subagent-tool-scope.test.ts — add wiring test importing the helpers from ../src/index.js + asserting a real write/shell tool name is vetoed under tools:["read_file"]
docs.md — document AgentDefinition.tools + withSubagentToolScope
CHANGELOG.md (root) — [Unreleased] Added entry
.changeset/m4-tool-scoping.md — NEW: minor bump @theokit/sdk
```

#### Deep file dependency analysis
- Barrel adds the two helpers (additive). Wiring test imports from `../src/index.js` (public surface) + asserts a concrete tool name veto.

#### Deep Dives
- The wiring test proves through the public barrel: `withSubagentToolScope({tools:["read_file"]}, async () => checkToolWhitelist("write_file"))` blocked. (checkToolWhitelist stays internal; the test imports it from its internal path while the helpers come from the barrel.)

#### Tasks
1. Barrel-export the two helpers.
2. Add the wiring test (barrel import + concrete-tool-name veto).
3. Document; CHANGELOG; changeset (`biome format --write` before commit).

#### TDD
```
RED:     scope_helpers_exported_from_barrel() — import withSubagentToolScope + subagentToolWhitelist from ../src/index.js; a read-only scope vetoes a real write/shell tool name
GREEN:   barrel export (this task)
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/subagent-tool-scope.test.ts && pnpm --filter @theokit/sdk build
```

#### Acceptance Criteria
- [ ] Wiring test green — `pnpm --filter @theokit/sdk exec vitest run tests/subagent-tool-scope.test.ts` reports all tests passed.
- [ ] `pnpm --filter @theokit/sdk build` emits dist; `pnpm run validate:attw` 🌟 for the new exports.
- [ ] `docs.md` documents `AgentDefinition.tools` + scope; CHANGELOG `[Unreleased] Added` entry present `(#M4-6)`.
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check src/internal/runtime/skills/subagent-tool-scope.ts` reports 0 warnings.

#### DoD
- [ ] Wiring test green; barrel exports have a real caller
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck` exits 0
- [ ] CHANGELOG + changeset present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `AgentDefinition.tools?: string[]` | T1.1 | additive field (D1) |
| 2 | Subagent frontmatter `tools` parse | T1.1 | comma/space split (D4) |
| 3 | Enforcement via `withToolWhitelist` (NOT PermissionEngine) | T1.2 | `withSubagentToolScope` (D2) |
| 4 | Read-only sub-agent provably without Write/Bash | T1.2, T2.1 | proof via real `checkToolWhitelist` + concrete tool name |
| 5 | Unscoped sub-agents unaffected | T1.2 | undefined → passthrough (D3) |
| 6 | Barrel export + no orphan | T2.1 | wiring test |
| 7 | Docs + CHANGELOG + changeset | T2.1 | additive |

**Coverage: 7/7 requirements covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk test` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck` exits 0
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk exec biome check` clean
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Backward compatibility preserved — `AgentDefinition` without `tools` unchanged (existing subagent tests green)
- [ ] Plan-specific: a `tools:["read_file"]` sub-agent provably has `write_file`/`shell_exec` vetoed by the same `checkToolWhitelist` the agent loop runs (NOT PermissionEngine)
- [ ] `docs.md` documents `AgentDefinition.tools` + `withSubagentToolScope`
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the declaration + enforcement bridge in the built package.

### Execution
```
pnpm --filter @theokit/sdk build
pnpm --filter @theokit/sdk test
pnpm --filter @theokit/sdk typecheck
pnpm --filter @theokit/sdk exec biome check packages/sdk/src packages/sdk/tests
pnpm run validate:attw
```

### Acceptance Criteria
- [ ] All test suites green — `pnpm --filter @theokit/sdk test` exits 0
- [ ] Coverage ≥ 90% on changed files (`subagent-tool-scope.ts` — critical paths 100%)
- [ ] Zero type/lint errors — `pnpm --filter @theokit/sdk typecheck` + `pnpm --filter @theokit/sdk exec biome check` each exit 0
- [ ] No regression — `pnpm --filter @theokit/sdk test` reports the full sdk suite passing (≥ baseline 2811)
- [ ] Enforcement proof — `pnpm --filter @theokit/sdk exec vitest run tests/subagent-tool-scope.test.ts` confirms a real write/shell tool name is vetoed by `checkToolWhitelist` under `tools:["read_file"]` (NOT via PermissionEngine)

### If Validation Fails
1. Separate plan-caused from pre-existing failures.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
