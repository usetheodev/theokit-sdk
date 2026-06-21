# Discovery Plan: M3-5 — ACI description override + render `<tools>`

> **Version 1.0** — Investigate how coding agents (a) let a consumer override/tune a tool's LLM-facing description (the ACI — Agent-Computer Interface — wording that materially affects tool-selection accuracy) and (b) render the tool list into the prompt FROM THE SAME tool array the agent uses (single source of truth, no drift), to design `withDescription(tool, description): CustomTool` + `renderToolList(tools): string` in `@theokit/sdk-tools`. opencode (`tool/AGENTS.md` — `Tool.make({description})` canonical field), codex (`code-mode/src/description.rs` tool-description generation), and the in-repo Hermes tool-registry pattern (`sdk-references/tool-registry-pattern.md` — `ToolEntry` + `getAvailableTools` source-of-truth rendering) provide the precedent; the M3-4 wrapper (`internal/tool-guidance.ts`) is the mirror shape (clone-with-override). Blueprint output: the `withDescription` signature, the `renderToolList` `<tools>` format, and the single-source-of-truth contract.

**Slug:** `m3-aci-tools`
**Owner:** paulo
**Created:** 2026-06-21
**Time budget:** 2h (per-project breakdown in ADR D1)

## Context

Roadmap gap M3-5 (`docs/gap-audit/ROADMAP.md:127`, med sev, size S, Tema C). Baseline (confirmed greenfield via Explore): no `withDescription`, no `renderToolList`, no `<tools>` rendering anywhere. `CustomTool` (`packages/sdk/src/types/agent-prims.ts:46-64`) has `name`/`description`/`inputSchema`/`handler`; `description` "drives tool-selection accuracy". The M3-4 wrapper `withToolResultGuidance` (`packages/sdk-tools/src/internal/tool-guidance.ts:68-75`) established the clone-with-override pattern (build a CustomTool literal, preserve all fields, override one) — `withDescription` is the analogue overriding `description`. `renderToolList(tools)` renders a `<tools>` block from the SAME array the agent runs (the gap audit's "Override + render de single source, sem drift"). Respects `rules/architecture.md` §2 + `rules/no-stubs-no-mocks-no-wired.md`. Zero new deps.

## Objective

Decide the `withDescription(tool, description)` signature, the `renderToolList(tools)` `<tools>` output format, and the single-source-of-truth contract (the rendered list reads the SAME `CustomTool[]` the agent uses, so it cannot drift) — backed by opencode's canonical-description tool model, codex's tool-description generation, and the in-repo Hermes tool-registry rendering. Success criteria:

- [ ] All research questions answered with citations to `.claude/knowledge-base/reference/` + in-repo
- [ ] Cross-cutting comparison populated (codex / opencode / in-repo Hermes-pattern)
- [ ] Recommendations give ≥ 1 concrete proposal per question (esp. the two signatures + the `<tools>` format)
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/reference/opencode/` | `packages/core/src/tool/AGENTS.md` | `Tool.make({description})` — description as a canonical field; tools immutable (override = new instance) |
| `.claude/knowledge-base/reference/codex/` | `codex-rs/code-mode/src/description.rs`, `codex-rs/core/templates/search_tool/tool_description.md` | tool-description generation + a description template rendered for the LLM |
| (in-repo) `.claude/knowledge-base/sdk-references/tool-registry-pattern.md` | — | `ToolEntry` (name+description+schema) + `getAvailableTools` returning the array that IS the render source |
| (in-repo) `packages/sdk-tools/src/internal/tool-guidance.ts` + `packages/sdk/src/types/agent-prims.ts` | — | the mirror clone-with-override pattern (M3-4) + the `CustomTool` contract |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/reference/adk-js/`, `crewAI/` | No distinct description-override + list-render pattern found (baseline) |
| A full tool registry / availability-filter (`getAvailableTools` checkFn/requiresEnv) | Out of scope for v1 — M3-5 is description override + render only; registry/filter is a later concern |
| Decorator-driven tool config (`@Skills`, `@ContextWindow`) | M8-x — M3-5 is the imperative `withDescription`/`renderToolList`; decorators may drive them later |
| `.claude/knowledge-base/reference/*/{node_modules,dist,target}/` | Build artifacts |

## ADRs

### D1 — Time budget + stop conditions
**Decision:** opencode tool model: 0.5h, codex description gen + template: 0.5h, in-repo Hermes registry + M3-4 mirror + CustomTool: 1h.
**Rationale:** the M3-4 mirror + the `ToolEntry`/`getAvailableTools` source-of-truth pattern are the load-bearing internal precedents; the external refs confirm description-as-canonical-field.
**Stop condition — per question:** empty search after 3 variants → BLOCKED, continue. **Per project:** budget exhausted → mark remaining BLOCKED; if all done/blocked, emit BLUEPRINT_BLOCKED.
**Anti-pattern:** NEVER let `renderToolList` read a SEPARATE list from the agent's real tools — single source of truth is the whole point (no drift).

### D2 — Investigation depth
**Decision:** Read opencode `tool/AGENTS.md` (description canonical + immutability), codex `description.rs` + the description template; map onto the M3-4 clone-with-override + the `CustomTool` contract + the Hermes `getAvailableTools` render-from-array pattern.
**Rationale:** the two signatures + the `<tools>` format are the high-value output.
**Consequences:** `withDescription` returns a new CustomTool (immutability, matching opencode); `renderToolList` reads `CustomTool[]` directly (no parallel registry).

## Research Questions

| # | Question | Corner | Reference(s) | Fase A (broad) | Fase B (deep Read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How do opencode / the in-repo Hermes refs TEST tool description + list rendering? | tests | opencode, in-repo | Grep opencode tool tests + Hermes registry tests | Read `tool/AGENTS.md` + `sdk-references/tool-registry-pattern.md` render path | Table → SDK RED tests (withDescription overrides only description; renderToolList lists name+desc for each; empty list → empty/marker block; reflects an overridden description = no drift) |
| Q2 | What does description-override + list-render DEPEND on? Zero deps? | deps | opencode, in-repo | Read opencode Tool.make deps + define-tool | Confirm CustomTool is a plain object → clone is a spread; render is string join | Verdict: zero new deps — clone-with-override + string template; opencode uses Effect (not portable) |
| Q3 | What is the module/signature shape for the override + the render? | tools | opencode, codex, in-repo | Read `agent-prims.ts` CustomTool + M3-4 `tool-guidance.ts:68` | Read the M3-4 clone-with-override literal + codex `description.rs` | Module shape → `withDescription(tool, description): CustomTool` + `renderToolList(tools, opts?): string` in `sdk-tools/src/internal/tool-aci.ts`, barrel-exported |
| Q4 | OVERRIDE TECHNIQUE: how to override a description immutably without breaking the contract? | techniques | opencode, in-repo | Read opencode immutability note + M3-4 literal | Map onto a CustomTool literal preserving name/inputSchema/handler, overriding description | `withDescription` returns `{ ...preserve, description }` (new instance; original untouched) |
| Q5 | RENDER TECHNIQUE: the `<tools>` block format + single-source-of-truth (no drift) + empty-list handling | techniques | codex, in-repo | Read codex description template + Hermes `getAvailableTools` | Decide the `<tools>` line format (name + description) read from the SAME `CustomTool[]` | `renderToolList(tools)` → `<tools>\n  <tool><name>..</name><description>..</description></tool>...\n</tools>` from the agent's actual array; empty → `<tools></tools>` |

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
| Q4 immutability gate | `withDescription` returns a NEW CustomTool; the original tool object is not mutated; name/inputSchema/handler preserved | re-iterate; keep clone-with-override |
| Q5 single-source gate | `renderToolList` reads the SAME `CustomTool[]` the agent runs — NOT a parallel registry/list (no drift) | re-iterate; render from the passed array only |
| Q5 empty gate | the render handles an empty tool array gracefully (a well-formed empty `<tools>` block, never a throw) | re-iterate; record the empty case |
| Before promising complete | all 4 corners populated + ≥ 1 ADR | refuse promise, continue |

## Acceptance Criteria

- [ ] All 5 research questions answered OR marked BLOCKED with reason
- [ ] Every citation resolves (reference + in-repo)
- [ ] Cross-cutting comparison populated (codex / opencode / in-repo Hermes-pattern)
- [ ] Blueprint proposes `withDescription` + `renderToolList` signatures + the `<tools>` format + the single-source-of-truth contract, backed by opencode + codex + in-repo
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS (per `rules/discover-blueprint-golden-rule.md`)
- [ ] No fabricated citations
- [ ] All 4 coverage corners populated
- [ ] ADRs cover: both signatures, override immutability, render format, single-source-of-truth, zero-deps, placement
