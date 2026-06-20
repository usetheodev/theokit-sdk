# Discovery Plan: M1-5 — `SDKMessage` readers on a `./messages` subpath

> **Version 1.1** (absorbed edge-case review `reviews/m1-sdkmessage-readers-edge-cases-2026-06-20.md`: EC-1 — map ADK `Content.parts` onto the SDK's `TextBlock|ToolUseBlock` discriminated shape; EC-2 — `extractToolUses` reads the assistant message's `ToolUseBlock`s, not the `tool_call` event; both added as halt-loop checkpoints) — Investigate how to expose a `@theokit/sdk/messages` subpath of pure readers over `SDKMessage` — `assistantText(msg)`, `extractToolUses(msg)`, and usage/cost helpers that preserve `amountUsd: number | undefined` (ADR D377 honesty — never coerce to 0) — promoting the proven first-party hand-roll `theocode/server/lib/sdk-mappers.ts`. The blueprint compares Google ADK-JS content extractors (`getFunctionCalls`, `content_processor_utils`) and CrewAI's usage-metrics reading against the first-party mappers + the SDK's own `SDKMessage`/`CostBreakdown` shapes, to lock the reader signatures, the honesty contract, and the subpath wiring before any code.

**Slug:** `m1-sdkmessage-readers`
**Owner:** paulo
**Created:** 2026-06-20
**Time budget:** 3h (per-project breakdown in ADR D1)

## Context

Roadmap gap M1-5 (gap #34, `gap-audit/THEOKIT_GAP_AUDIT.md:80,123`): a consumer reading the `SDKMessage` stream has no public readers — it hand-rolls a wire-event mapper. The proof is first-party: `theocode/server/lib/sdk-mappers.ts:17-99` ships `assistantText` (concatenate an assistant message's text blocks), `usageToTokens`, `costToDomain` (preserve `amountUsd ?? null`, NEVER 0 — ADR D377), and `toolCallToEvent`, re-exported from `agent-stream.ts:76`.

The SDK already owns the input/output types: the `SDKMessage` union (`packages/sdk/src/types/messages.ts:161`) with `SDKAssistantMessage` (`content: Array<TextBlock | ToolUseBlock>`, `:58-66`), `ToolUseBlock` (`:19`), `TokenUsage` + `CostBreakdown` (`amountUsd: number | undefined`, `packages/sdk/src/types/usage.ts`). It has NO `./messages` subpath (`package.json` exports has `./retry`, `./concurrency`, `./path-safety` but not `./messages`), and `assistantText` exists only as a fixture builder + a struct field — not a public reader. `extractToolUses` does not exist.

This discovery exists to lock three open decisions before `/to-plan`, by comparing the field's content-extraction patterns against the first-party mappers: (a) the exact reader signatures over the SDK's real `SDKMessage` (vs theocode's minimal structural views); (b) the usage/cost honesty contract (`amountUsd: number | undefined` preserved, never 0); (c) the `./messages` subpath wiring (does its DTS reach `internal/runtime` — needing the tsc-exception the retry/concurrency entries use — or stay on leaf types?).

Project rules honored: `architecture.md` §2 (pure readers, no I/O — leaf-type dependency), `testing.md` §3 (deterministic pure-function unit tests), `no-stubs-no-mocks-no-wired.md` (public-primitive exception — readers ship as consumer-facing exports with docs + tests), Unbreakable Rule 9 (promote the proven first-party mappers, don't reinvent).

## Objective

Produce a blueprint that lets us decide the exact contract of the `./messages` readers — signatures over `SDKMessage`, the usage/cost honesty rule, and the subpath wiring — backed by the field's content extractors and the first-party mappers.

- [ ] All research questions answered with citations to `.claude/knowledge-base/reference/`
- [ ] Cross-cutting comparison table populated (ADK-JS extractors vs CrewAI usage vs theocode mappers)
- [ ] Recommendations section provides one concrete decision per open question (signatures, honesty contract, subpath wiring)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/reference/adk-js/` | `core/src/events/event.ts`, `core/src/agents/processors/content_processor_utils.ts`, `core/test/events/`, `core/test/agents/processors/` | Direct analog: `getFunctionCalls`/`getFunctionResponses` (extract tool-use from message parts) + content/text extraction + their tests |
| `.claude/knowledge-base/reference/crewAI/` | `lib/crewai/src/crewai/types/usage_metrics.py`, `lib/crewai/src/crewai/utilities/token_counter_callback.py` | Usage-metrics reading: how token usage is structured + read from a model response |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/reference/codex/`, `opencode/` | Their message reading is TUI/session-render-driven, not pluggable pure readers — adk-js + crewAI are the clean analogs |
| `.claude/knowledge-base/reference/adk-js/**/dist/`, `node_modules/` | Build artifacts |
| ADK-JS streaming / live-flow modules | M1-5 is pure readers over a completed `SDKMessage`, not the streaming transport |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** ADK-JS: 1.5h (content/tool-use extractor analog), CrewAI: 1h (usage-reading analog), buffer 0.5h.

**Rationale:** ADK-JS `getFunctionCalls`/content utils are the direct analog for `extractToolUses`/`assistantText`; CrewAI's usage_metrics informs the usage helper. Codex/opencode excluded (see out-of-scope).

**Alternatives considered:** ADK-JS only (rejected — CrewAI validates the usage/cost reader cross-language); equal 4-way split (rejected — codex/opencode dilute).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty after 3 query-variant retries, mark it BLOCKED "Fase A exhausted" and continue. Do NOT pad with unrelated hotspots.

**Stop condition — per project (mandatory):** budget exhausted with N pending → mark them BLOCKED "budget exhausted" and continue; if every remaining question is `done`/`blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>` (never `BLUEPRINT_COMPLETE` from a blocked state).

**Anti-pattern:** NEVER fabricate Fase B answers to close a Fase-A-exhausted question (Unbreakable Rule 3).

**Consequences:** the halt-loop stops per-project on budget exhaustion; blocked questions become next-discovery seed.

### D2 — Investigation depth

**Decision:** Read each ADK-JS extractor + its test end-to-end; Grep-then-Read the crewAI usage files.

**Rationale:** the extractor signatures + part-iteration logic are the load-bearing evidence; usage reading needs only the structure.

**Consequences:** budget concentrated on the extractor + usage-shape files.

### D3 — First-party current-state is context, not a discover target

**Decision:** Treat `theocode/server/lib/sdk-mappers.ts`, the SDK's `SDKMessage`/`ToolUseBlock`/`CostBreakdown` types, and the existing subpath wiring (`package.json` exports + `tsup.config.ts` entry for `./retry`/`./concurrency`, incl. the tsc-DTS-cycle exception) as already-known current state cited inline — NOT as `reference/` questions.

**Rationale:** per `cycle-discover.md` ("Do NOT trigger DISCOVER for questions answered by reading your own code"), first-party code needs no discovery. The discovery's value is the EXTERNAL comparison informing the reader-signature + honesty ADRs.

**Consequences:** research questions target only `reference/` projects; the blueprint's Recommendations synthesize external findings against the first-party mappers + the SDK's own subpath pattern.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does ADK-JS `getFunctionCalls`/`getFunctionResponses` EXTRACT tool calls from a message's content parts (iteration, filtering, return shape)? | techniques | `.claude/knowledge-base/reference/adk-js/core/src/events/event.ts` | Read `getFunctionCalls`/`getFunctionResponses` (`:108-130`); grep `functionCall`/`parts` | Read both functions + the part shape they read | Prose + line cites: part-iteration + filter predicate + return type — the `extractToolUses` analog |
| Q2 | How does ADK-JS extract/concatenate TEXT from message content (`content_processor_utils` / `getContents`)? | techniques | `.claude/knowledge-base/reference/adk-js/core/src/agents/processors/content_processor_utils.ts` | Read `getContents`/text helpers; grep `\.text`/`parts` | Read the text-extraction path | Text-concat logic (filter text parts, join, empty handling) — the `assistantText` analog |
| Q3 | How does CrewAI STRUCTURE + READ token usage (and does it ever coerce a missing value to 0)? | techniques | `.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/types/usage_metrics.py`, `lib/crewai/src/crewai/utilities/token_counter_callback.py` | Read `usage_metrics.py` fields; grep `prompt_tokens`/`?? 0`/`or 0`/`get(` | Read the field defaults + the callback's accumulation | Usage struct fields + default handling — informs the SDK usage/cost honesty (never-0) reader |
| Q4 | How are these extractors TESTED — text concat, tool-call extraction, empty/no-parts edge cases? | tests | `.claude/knowledge-base/reference/adk-js/core/test/events/event_test.ts`, `core/test/agents/processors/content_processor_utils_test.ts` | Grep `getFunctionCalls`/`getContents`/`it(`/`expect(` | Read each relevant test case | Table: test → scenario (text/tool/empty) → assertion — seeds the SDK TDD cases |
| Q5 | Do ADK-JS / CrewAI add a DEPENDENCY for these readers, or are they first-party? | deps | `.claude/knowledge-base/reference/adk-js/core/src/events/event.ts`, `.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/types/usage_metrics.py` | Grep `import` in both | Read the imports | Per-project: first-party vs lib — confirms M1-5 needs no new dep |
| Q6 | How does ADK-JS PACKAGE/EXPORT its content-reader utilities (module location, public vs internal util)? | tools | `.claude/knowledge-base/reference/adk-js/core/src/agents/processors/content_processor_utils.ts`, `core/src/events/event.ts` | Grep `export`; check the module's directory + index re-exports | Read the export surface + where it sits | Module boundary description — informs the SDK `./messages` subpath shape (one reader module, leaf-type deps) |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q5 | Covered |
| Tools | Q6 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | every `.claude/knowledge-base/reference/{project}/{path}` declared in Fase A exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | Fase A returned ≥1 hotspot OR 3 query-variant retries attempted | After 3 retries empty, mark Qx BLOCKED "Fase A exhausted"; continue |
| After answering Qx | Blueprint section under Qx has ≥1 citation | Re-iterate Qx (1 retry max) |
| Q3 honesty (key) | Fase B captured whether CrewAI coerces a missing usage/cost value to 0 or preserves null/None | Required for the SDK never-0 honesty ADR; do not close Q3 without it |
| Q6 subpath wiring (key) | Fase B captured the reader module's dependency surface (leaf types only vs reaching runtime) | Required to decide whether `./messages` DTS needs the tsc-cycle exception (like retry/concurrency) or the plain rollup-plugin-dts path |
| Q1/Q2 shape mapping (EC-1) | Fase B captured that ADK iterates `content.parts[].functionCall/.text` — a DIFFERENT shape from the SDK's discriminated `TextBlock`/`ToolUseBlock` | Blueprint MUST map onto the SDK's `block.type === "text"|"tool_use"` filter (mirroring `sdk-mappers.ts`), not assume ADK's parts model transfers |
| Q1 extractToolUses source (EC-2) | the blueprint decided which SDKMessage place `extractToolUses` reads | Proposal: the assistant message's `ToolUseBlock`s (returns `[]` for non-assistant); the `tool_call` lifecycle event is a separate stream — state this before closing Q1 |
| Per-project time budget | budget not exhausted | When exhausted, mark remaining Qx BLOCKED "budget exhausted"; advance |
| Before promising complete | all 4 coverage corners have populated sections | Refuse promise, continue iterating |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/reference/{...}` path
- [ ] At least one ADR section in the blueprint synthesizes the reader-signatures, usage/cost-honesty, and subpath-wiring decisions
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/m1-sdkmessage-readers-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → plan-confidence → execute → confidence → improve if needed)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one project rule principle (Rule 9 promote `sdk-mappers.ts`; `architecture.md` §2 pure leaf-type readers; `testing.md` §3 deterministic units)
