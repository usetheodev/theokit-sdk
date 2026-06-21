# Discovery Plan: M3-4 — Rich errors (self-correction on tool fail)

> **Version 1.0** — Investigate how coding agents turn a tool FAILURE into actionable self-correction guidance for the LLM, to design a `withToolResultGuidance(tool, guidance)` wrapper (+ a shared `DEFAULT_TOOL_GUIDANCE` error-code→hint map) that augments a built-in tool's `{ok:false,error}` payload with a `guidance` string — without editing each of the 13 factories. opencode (`tool/invalid.ts` actionable error output + `tool/edit.ts` fuzzy edit-failure feedback) and codex provide the external precedent; the in-repo Hermes references (`sdk-references/tool-call-failure-recovery.md`, `error-context-surfacing.md`) provide the recovery-hint + typed-error-code pattern; the in-repo tool inventory (`packages/sdk-tools/src/*.ts`, ~13 tools × ~31 error codes) is the target surface. Blueprint output: the wrapper signature, the guidance map shape, the never-throw passthrough contract, and which error codes get which hints.

**Slug:** `m3-rich-errors`
**Owner:** paulo
**Created:** 2026-06-21
**Time budget:** 2.5h (per-project breakdown in ADR D1)

## Context

Roadmap gap M3-4 (`docs/gap-audit/ROADMAP.md:126`, med sev, size M, Tema C). Baseline (confirmed greenfield via Explore): no built-in tool attaches a `guidance` field; no `withToolResultGuidance` wrapper exists. The `defineTool` handler returns a JSON STRING (`packages/sdk/src/define-tool.ts`, `packages/sdk/src/types/agent-prims.ts` `CustomTool`), so guidance must be injected INSIDE the stringified `{ok:false,error,...}` object. The 13 built-in tools (`packages/sdk-tools/src/*.ts`) return flat `{ok:false,error:<code>,...context}` shapes (read-file `not_found`/`forbidden_path`/...; shell-exec `timeout`/`exec_failed`/`catastrophic_command`; web-fetch `ssrf_blocked`/...; etc) with NO recovery hint. The roadmap scopes M3-4 as "each factory attaches `guidance` to its own payload + a wrapper `withToolResultGuidance`". Respects `rules/architecture.md` §2 + `rules/no-stubs-no-mocks-no-wired.md`. Zero new deps (string post-processing).

## Objective

Decide the `withToolResultGuidance(tool, guidance)` wrapper signature, the `DEFAULT_TOOL_GUIDANCE` map shape (error-code → LLM-actionable hint), the never-throw passthrough contract (a non-JSON or `ok:true` result is returned unchanged), and the curated hint set for the common error codes — backed by opencode's actionable tool-failure output, codex's function-call error feedback, and the in-repo Hermes recovery-hint pattern. Success criteria:

- [ ] All research questions answered with citations to `.claude/knowledge-base/reference/` + in-repo
- [ ] Cross-cutting comparison populated (codex / opencode / in-repo Hermes-pattern)
- [ ] Recommendations give ≥ 1 concrete proposal per question (esp. the wrapper + the guidance map)
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/reference/opencode/` | `packages/opencode/src/tool/invalid.ts`, `packages/opencode/src/tool/edit.ts` | The actionable tool-failure output (`invalid.ts`) + fuzzy edit-failure feedback (`edit.ts`) — external precedent for turning a failure into guidance |
| `.claude/knowledge-base/reference/codex/` | `codex-rs/core/src` (function-call error formatting) | How codex feeds a tool/function-call error back to the model |
| (in-repo) `.claude/knowledge-base/sdk-references/tool-call-failure-recovery.md`, `error-context-surfacing.md` | — | The recovery-hint (dispatchTool error message) + typed-error-code+metadata pattern to mirror |
| (in-repo) `packages/sdk-tools/src/*.ts` + `packages/sdk/src/define-tool.ts` | — | The target surface (error inventory) + the `CustomTool` handler-returns-string contract |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/reference/adk-js/`, `crewAI/` | No distinct tool-error-guidance field found (baseline confirmed) |
| Editing each of the 13 built-in factories inline | Out of scope for v1 — a composable wrapper + default map avoids 13 risky edits (KISS); per-factory guidance can opt-in later |
| Provider/LLM-level error guidance (ProviderError retry) | That is the LLM call path, not the tool-result path; M3-4 is tool results |
| `.claude/knowledge-base/reference/*/{node_modules,dist,target}/` | Build artifacts |

## ADRs

### D1 — Time budget + stop conditions
**Decision:** opencode tool errors: 1h, codex function-call error: 0.5h, in-repo Hermes refs + tool inventory: 1h.
**Rationale:** opencode `invalid.ts`/`edit.ts` is the clearest external actionable-failure precedent; the in-repo inventory + contract is the load-bearing target.
**Stop condition — per question:** empty search after 3 variants → BLOCKED, continue. **Per project:** budget exhausted → mark remaining BLOCKED; if all done/blocked, emit BLUEPRINT_BLOCKED.
**Anti-pattern:** NEVER make the wrapper throw or alter an `ok:true` result; guidance is additive only on `ok:false`.

### D2 — Investigation depth
**Decision:** Read opencode `invalid.ts` + the edit-failure feedback in `edit.ts`; skim codex function-call error path; map onto the in-repo Hermes recovery-hint pattern + the `defineTool` string-return contract + the 13-tool error inventory.
**Rationale:** the wrapper shape + the error-code→hint curation is the high-value output; external refs confirm the "actionable failure" principle, the in-repo inventory supplies the actual codes.
**Consequences:** the SDK ships a composable wrapper + a curated default hint map for the common codes (not all 31), documented as best-effort guidance.

## Research Questions

| # | Question | Corner | Reference(s) | Fase A (broad) | Fase B (deep Read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How do opencode / the in-repo Hermes refs TEST tool-failure feedback? | tests | opencode, in-repo | Grep opencode tool tests + Hermes dispatchTool tests | Read opencode `tool/edit.ts` failure path + `sdk-references/tool-call-failure-recovery.md` | Table: test → asserted feedback → seeds SDK RED tests (ok:false gets guidance; ok:true untouched; unknown code → no guidance; non-JSON → passthrough) |
| Q2 | What does guidance-injection DEPEND on? Can the SDK do it zero-deps (string post-process)? | deps | opencode, in-repo | Read opencode tool result deps + define-tool.ts | Confirm handler returns string → JSON.parse/stringify only | Verdict: zero new deps — parse the handler's JSON string, augment, re-stringify; opencode uses Effect (not portable) |
| Q3 | What is the wrapper/module shape + the CustomTool handler contract? | tools | opencode, in-repo | Read `define-tool.ts` + `agent-prims.ts` CustomTool | Read `define-tool.ts:25` (handler `=> string`) + a built-in factory shape | Module shape → `withToolResultGuidance(tool, guidance): CustomTool` in `sdk-tools/src/internal/tool-guidance.ts`, barrel-exported; wraps `handler` |
| Q4 | GUIDANCE TECHNIQUE: how to turn an error code into an actionable hint + inject it without breaking the payload? | techniques | opencode, codex, in-repo | Read opencode `invalid.ts` output string + codex function-call error | Map the actionable-failure principle onto an error-code→hint map injected into `{ok:false}` | The injection algorithm (parse → if ok===false and guidance[error] and no existing guidance → add `guidance` → re-stringify) |
| Q5 | DEFAULT HINT SET + never-throw passthrough: which codes get which hints; what happens on ok:true / non-JSON / unknown code? | techniques | in-repo | Read the 13-tool error inventory | Curate hints for the common codes (not_found, path_traversal, forbidden_path, no_match, timeout, no_matches, ssrf_blocked, catastrophic_command) | `DEFAULT_TOOL_GUIDANCE` map + passthrough rules (ok:true unchanged, non-JSON unchanged, unknown code → no guidance, existing guidance preserved) |

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
| Q3 contract gate | the design respects that `handler` returns a STRING (guidance injected inside the JSON, not a wrapper object) | re-iterate; keep string-in/string-out |
| Q4 additive gate | guidance is added ONLY when `ok===false` AND a hint exists AND no guidance is already present; `ok:true` is never modified | re-iterate; record the additive rule |
| Q5 never-throw gate | a non-JSON handler output OR a parse error → the original string is returned UNCHANGED (the wrapper never throws and never corrupts a result) | re-iterate; record the passthrough contract |
| Before promising complete | all 4 corners populated + ≥ 1 ADR | refuse promise, continue |

## Acceptance Criteria

- [ ] All 5 research questions answered OR marked BLOCKED with reason
- [ ] Every citation resolves (reference + in-repo)
- [ ] Cross-cutting comparison populated (codex / opencode / in-repo Hermes-pattern)
- [ ] Blueprint proposes `withToolResultGuidance` signature + `DEFAULT_TOOL_GUIDANCE` map + injection algorithm + never-throw passthrough, backed by opencode + in-repo
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS (per `rules/discover-blueprint-golden-rule.md`)
- [ ] No fabricated citations
- [ ] All 4 coverage corners populated
- [ ] ADRs cover: wrapper signature, guidance map, injection algorithm, never-throw passthrough, zero-deps, placement
