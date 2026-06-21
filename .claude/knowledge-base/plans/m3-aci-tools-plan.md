---
slug: m3-aci-tools
created_at: 2026-06-21
goal: Add `withDescription(tool, description)` (immutable override) + `renderToolList(tools)` (a `<tools>` block from the same CustomTool array, escaped, empty-safe) to sdk-tools, measured by tests/tool-aci.test.ts passing green.
---

# Plan: M3-5 — ACI description override + render `<tools>`

> **Version 1.1** (edge-case-plan absorbed: EC-1 ampersand-first escaping folded into T1.1 TDD) — Close roadmap gap M3-5: ship two pure, zero-dep functions in `@theokit/sdk-tools` — `withDescription(tool, description): CustomTool` (immutably override a tool's LLM-facing description, original untouched, name/inputSchema/handler preserved) and `renderToolList(tools): string` (render a `<tools>` block from the SAME `CustomTool[]` the agent runs — single source of truth, no drift — with XML-escaping and empty-safe handling). Design locked by blueprint `m3-aci-tools` (discover-confidence SHIPPABLE 99.5, five ADRs covering signatures/override-immutability/single-source/escaping/placement).

## Goal

> "Ship `withDescription(tool, description)` + `renderToolList(tools)` in `@theokit/sdk-tools` — immutable override + single-source `<tools>` render — measured by `tests/tool-aci.test.ts` passing green."

## Context

Roadmap gap M3-5 (`docs/gap-audit/ROADMAP.md:127`, med sev, size S, Tema C). Greenfield (confirmed): no `withDescription`/`renderToolList`/`<tools>` rendering. `CustomTool` (`packages/sdk/src/types/agent-prims.ts:46-64`) is a plain object (name/description/inputSchema/handler) whose `description` "drives tool-selection accuracy". The M3-4 wrapper `withToolResultGuidance` (`packages/sdk-tools/src/internal/tool-guidance.ts:68-75`) established clone-with-override; `withDescription` is the analogue overriding `description`. `renderToolList` reads the agent's live array (the gap audit's "Override + render de single source, sem drift"). Respects `rules/architecture.md` §2 + `rules/no-stubs-no-mocks-no-wired.md`. Zero new deps.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk-tools/src/internal/tool-aci.ts` (NEW) | 0 | — | (the two functions) | — |
| `packages/sdk-tools/src/index.ts` | 69 | 5c40feb | sdk-tools barrel | additive exports only |
| `packages/sdk-tools/tests/tool-aci.test.ts` (NEW) | 0 | — | unit tests — RED first | — |
| `docs.md` | (contract) | — | public API contract | additive ACI note |
| `CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive Added entry |

### Current callers / dependents

- **NEW** `withDescription`/`renderToolList` — barrel-exported reusable helpers (consumer composes them over their tool list). Exercised through the barrel + against real built-in tools in tests → no orphan. Consistent with the `tool-guidance`/`formatCode` LEGO-piece precedent.
- **`CustomTool`** (`@theokit/sdk`) — the operated-on contract. Existing peer dep.

### Domain glossary

- **ACI (Agent-Computer Interface)** — the LLM-facing tool wording (name + description) that materially affects tool-selection accuracy; M3-5 makes the description tunable.
- **single source of truth** — `renderToolList` reads the SAME `CustomTool[]` the agent runs, so the rendered list cannot drift from the real tools.
- **immutable override** — `withDescription` returns a NEW tool; the original object is not mutated.

### Architecture boundaries affected

Per `rules/architecture.md` §2: `tool-aci.ts` is pure domain logic (no I/O) in sdk-tools `internal/`, barrel-exported, importing `CustomTool` (public) from `@theokit/sdk`. No DIP boundary crossed.

## Prior Art & Related Work

- **Internal blueprint** `knowledge-base/discoveries/blueprints/m3-aci-tools-blueprint.md` (five ADRs).
- **In-repo precedent** the M3-4 clone-with-override (`packages/sdk-tools/src/internal/tool-guidance.ts:68`); the Hermes `getAvailableTools` render-from-array (`.claude/knowledge-base/sdk-references/tool-registry-pattern.md`).
- **Reference precedent** opencode `tool/AGENTS.md` (`Tool.make({description})` canonical + immutable, `.claude/knowledge-base/reference/opencode/packages/core/src/tool/AGENTS.md`); codex `code-mode/src/description.rs` + `core/templates/search_tool/tool_description.md`.

## Objective

- [ ] `tool-aci.ts` exports `withDescription(tool, description): CustomTool` + `renderToolList(tools): string`.
- [ ] `withDescription` returns a new tool with the overridden description; preserves name/inputSchema/handler; does NOT mutate the original.
- [ ] `renderToolList` renders a `<tools>` block (name + description per tool) from the passed array; reflects an overridden description (no drift).
- [ ] XML-escapes `&`/`<`/`>` in name+description; empty array → `<tools></tools>`; never throws.
- [ ] Zero new deps; barrel exports; docs.md + CHANGELOG + changeset.
- [ ] `tests/tool-aci.test.ts` green; typecheck + Biome clean; build emits dist.

## ADRs

### D1 — Two pure functions: immutable override + array render
**Decision:** `withDescription(tool, description): CustomTool` (clone-with-override) + `renderToolList(tools): string` (`<tools>` from the same array).
**Rationale:** mirrors M3-4 + opencode immutability; the render reads the agent's real array so it cannot drift. Zero deps.
**Alternatives considered:** mutate in place (rejected — shared-state bug); a separate registry to render from (rejected — drift, the exact gap-audit warning).

### D2 — Override preserves all other fields, original untouched
**Decision:** `{ name, description, inputSchema, handler }` with only `description` replaced; original not mutated.
**Rationale:** immutability (opencode) + contract fidelity (M3-4).
**Alternatives considered:** `Object.assign(tool, {description})` (rejected — mutates original).

### D3 — renderToolList reads the SAME array (single source of truth)
**Decision:** takes the same `CustomTool[]` the agent is configured with; no parallel registry.
**Rationale:** "Override + render de single source, sem drift" — derived from the live tools.
**Alternatives considered:** a maintained description catalog rendered separately (rejected — drift).

### D4 — Escape text + empty-safe (never throws)
**Decision:** XML-escape `&`/`<`/`>` in name+description; empty array → `<tools></tools>`.
**Rationale:** an angle-bracket description must not malform the block (EC-1); empty is valid (EC-3).
**Alternatives considered:** no escaping (rejected — malformed); throw on empty (rejected — empty valid).

### D5 — Placement internal/ + barrel export
**Decision:** `packages/sdk-tools/src/internal/tool-aci.ts`; barrel-export both.
**Rationale:** sibling of `tool-guidance.ts`; internal/ for logic, barrel for reuse.
**Alternatives considered:** in `@theokit/sdk` core (rejected — operates on sdk-tools' CustomTool surface).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `<tools>` render is a prompt aid, not the provider wire schema | Low | documented (EC-3); the wire schema stays `inputSchema` | SDK |
| `withDescription` accepts any string (incl. empty) | Low | the caller owns the wording (EC-2); CustomTool requires non-empty at creation | SDK |
| Exported helpers with no in-SDK runtime caller (consumer-facing) | Low | barrel-exported LEGO pieces (like `tool-guidance`/`formatCode`); exercised against real tools in tests; `no-stubs` §3 scoped to `packages/sdk/src` | SDK |

## Unresolved Questions

- (none — every decision resolved at plan time via the blueprint's five ADRs. A tool registry / availability filter + decorator-driven config are explicitly deferred — YAGNI here.)

## Dependency Graph

```
Phase 1 (withDescription + renderToolList + tests) ──▶ Phase 2 (barrel export + docs + changeset + CHANGELOG) ──▶ Final Phase (integration validation)
```

---

## Phase 1: The ACI helpers

### T1.1 — `tool-aci.ts` (withDescription + renderToolList)

#### Objective
Create `internal/tool-aci.ts` with the immutable override + the single-source `<tools>` renderer.

#### Why this step (action + reasoning)
1. **What** — `withDescription` (clone-with-override) + `renderToolList` (escaped, empty-safe `<tools>` from the same array).
2. **Why now** — both are pure and fully unit-testable; the render's no-drift property is the load-bearing ACI guarantee.

#### Evidence
Blueprint D1-D4 + Technique 1/2. `packages/sdk/src/types/agent-prims.ts:46-64` (CustomTool). M3-4 `packages/sdk-tools/src/internal/tool-guidance.ts:68-75` (mirror). opencode immutability (`.claude/knowledge-base/reference/opencode/packages/core/src/tool/AGENTS.md`). Hermes render-from-array (`.claude/knowledge-base/sdk-references/tool-registry-pattern.md`).

#### Files to edit
```
packages/sdk-tools/src/internal/tool-aci.ts — NEW: withDescription, renderToolList
packages/sdk-tools/tests/tool-aci.test.ts — NEW: RED tests first
```

#### Deep file dependency analysis
- `tool-aci.ts` imports `CustomTool` from `@theokit/sdk`. No other file changes this task. Exercised against `createReadFileTool` (real tool) in tests.

#### Pseudo-code / Signatures
```pseudocode
function withDescription(tool: CustomTool, description: string): CustomTool
  return { name: tool.name, description, inputSchema: tool.inputSchema, handler: tool.handler }
function esc(s): string  // & < > → &amp; &lt; &gt;
function renderToolList(tools: CustomTool[]): string
  if tools.length === 0 return "<tools></tools>"
  join ["<tools>", ...per tool: <tool><name>esc</name><description>esc</description></tool>, "</tools>"]
```

#### TDD
```
RED: test_with_description_overrides_only_description() — withDescription(tool,"new").description === "new"; name/inputSchema/handler unchanged
RED: test_with_description_does_not_mutate_original() — original tool.description unchanged after withDescription
RED: test_render_lists_each_tool_name_and_description() — renderToolList([a,b]) contains a.name, a.description, b.name
RED: test_render_reflects_overridden_description_no_drift() — renderToolList([withDescription(tool,"OVERRIDDEN")]) contains "OVERRIDDEN" (single source)
RED: test_render_empty_array() — renderToolList([]) === "<tools></tools>" (no throw)
RED: test_render_escapes_angle_brackets() — a description with "<b> & </b>" → rendered block contains &lt;/&amp;/&gt;, not raw "<b>"
RED: test_render_escapes_ampersand_first() — "a < b & c" → contains &lt; and &amp; once each, no double-escaped &amp;lt; (edge EC-1)
RED: test_with_description_on_real_tool() — withDescription(createReadFileTool({projectRoot}),"custom").description === "custom" and handler still works
GREEN: implement tool-aci.ts
REFACTOR: Biome complexity ≤ 10
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/tool-aci.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/tool-aci.test.ts` reports 8/8 tests passed
- [ ] `test_with_description_does_not_mutate_original` passes (immutability, D2)
- [ ] `test_render_reflects_overridden_description_no_drift` passes (single source, D3)
- [ ] `test_render_escapes_angle_brackets` + `test_render_empty_array` pass (D4)
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check packages/sdk-tools/src/internal/tool-aci.ts` reports 0 errors

#### DoD
- [ ] those tests green; `pnpm --filter @theokit/sdk-tools typecheck` exits 0

---

## Phase 2: Export + document

### T2.1 — Barrel export + docs + changeset + CHANGELOG

#### Objective
Export both functions from the barrel; add docs.md note, changeset, CHANGELOG entry; barrel re-export test.

#### Why this step (action + reasoning)
1. **What** — add exports to `index.ts`; document; changeset + CHANGELOG.
2. **Why now** — per `no-stubs-no-mocks-no-wired.md` the helpers need a reachable surface; per CLAUDE.md docs.md reflects the public surface change.

#### Evidence
`index.ts` barrel. Blueprint D5. The `tool-guidance` export precedent.

#### Files to edit
```
packages/sdk-tools/src/index.ts — export withDescription, renderToolList
packages/sdk-tools/tests/tool-aci.test.ts — barrel re-export test
docs.md — ACI note
CHANGELOG.md (root) — [Unreleased] § Added entry
.changeset/m3-aci-tools.md — NEW minor changeset
```

#### Deep file dependency analysis
- `index.ts` additive exports from `./internal/tool-aci.js`. Barrel test imports from `../src/index.js`.

#### TDD
```
RED: test_aci_symbols_exported() — import { withDescription, renderToolList } from barrel → both functions
GREEN: add barrel exports + docs + changeset + CHANGELOG
REFACTOR: none (additive)
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/tool-aci.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/tool-aci.test.ts` reports all tests passed (8 + 1 barrel)
- [ ] `test_aci_symbols_exported` passes (barrel)
- [ ] `grep -c "withDescription\|renderToolList" docs.md` returns ≥ 1 AND `ls .changeset/m3-aci-tools.md` exists AND `grep -c "withDescription\|renderToolList" CHANGELOG.md` ≥ 1
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check` clean on changed files

#### DoD
- [ ] tests green; typecheck exit 0; `pnpm --filter @theokit/sdk-tools build` succeeds; docs/changeset/CHANGELOG present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No description override (M3-5) | T1.1 | `withDescription` clone-with-override (D1/D2) |
| 2 | No `<tools>` render (M3-5) | T1.1 | `renderToolList` `<tools>` block (D1) |
| 3 | Single source of truth (no drift) | T1.1 | render reads the same array (D3) |
| 4 | Immutability | T1.1 | original untouched (D2) |
| 5 | Escaping / empty-safe / never-throw | T1.1 | XML-escape + empty block (D4) |
| 6 | Zero new deps | T1.1 | spread + string join (D1/Rule 9) |
| 7 | Reflect override in render | T1.1 | same array → no drift (D3) |
| 8 | Document + record + export | T2.1 | barrel + docs.md + changeset + CHANGELOG + barrel test |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools exec vitest run` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk-tools exec biome check`
- [ ] Dead-code gate — `pnpm quality:dead` (knip) exits 0 (NOTE: sdk-tools is not a knip workspace, so this does not prove these exports are wired; orphan-safety is the integration test against `createReadFileTool` + the `tool-guidance`/`formatCode` LEGO precedent; `no-stubs` §3 is scoped to `packages/sdk/src`)
- [ ] Build clean — `pnpm --filter @theokit/sdk-tools build`
- [ ] File-size budget respected (`tool-aci.ts` ≤ 500, target ≤ 100)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] `docs.md` reflects the ACI helpers
- [ ] Plan-specific: override immutable (original untouched); render single-source (overridden description reflected, no drift); escaped + empty-safe; zero new deps
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M3-5 introduces ZERO new dependencies — object spread + string join + the existing `@theokit/sdk` `CustomTool` peer (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` (`CustomTool`) | workspace | npm/TS | tool contract (existing peer dep) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | An XML builder lib was considered + rejected: the `<tools>` block is a fixed 4-tag shape with a 3-replacement escape — a lib is overkill. | n/a — in-house |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

Both functions are pure (no I/O) and never throw: `withDescription` is an object spread; `renderToolList` is a string join with escaping, handling the empty array explicitly. There is no runtime failure mode that propagates an exception.

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/sdk-tools exec vitest run tests/tool-aci.test.ts
pnpm --filter @theokit/sdk-tools exec vitest run        # full sdk-tools suite — no regression
pnpm --filter @theokit/sdk-tools typecheck
pnpm --filter @theokit/sdk-tools exec biome check
pnpm quality:dead
pnpm --filter @theokit/sdk-tools build
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/tool-aci.test.ts` reports 9 tests passed (0 failed)
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run` exits 0 with 0 failed tests (full suite, no regression)
- [ ] `pnpm --filter @theokit/sdk-tools typecheck` exits 0 (0 type errors) and `pnpm --filter @theokit/sdk-tools exec biome check` reports 0 warnings
- [ ] `pnpm quality:dead` exits 0
- [ ] `pnpm --filter @theokit/sdk-tools build` succeeds (dist emitted)
- [ ] Runtime-metric proof — N/A (pure functions; observable via the returned tool / `<tools>` string)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures. 2. Fix all plan-caused. 3. Re-run. 4. Log pre-existing in the PR.
