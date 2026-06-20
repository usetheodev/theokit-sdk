# Discovery Plan: M1-3 — Continuation-history rebuild (`buildReplayHistory`)

> **Version 1.1** (absorbed edge-case review `reviews/m1-continuation-history-edge-cases-2026-06-20.md`: EC-1 reframed Q5 to preserve the pure-function boundary; EC-2/EC-3 added as halt-loop checkpoints) — Investigate how to expose a pure `buildReplayHistory(base, events, { contextWindowTokens })` in `@theokit/sdk` that rebuilds a **bounded** replay history for the STATELESS continuation path (a server reconstructs working memory from persisted stream events on a fresh request), reusing the SDK's `truncateWithMarker`. The blueprint compares the field's mature context-compaction strategies (Google ADK-JS `TruncatingContextCompactor` / `TokenBasedContextCompactor`, CrewAI `token_manager`) against the proven first-party hand-roll (`theocode/server/lib/continuation-history.ts`) to lock the role-mapping, budget-formula, and trim-policy ADRs before any code.

**Slug:** `m1-continuation-history`
**Owner:** paulo
**Created:** 2026-06-20
**Time budget:** 3h (per-project breakdown in ADR D1)

## Context

The gap audit (gap #20 / roadmap M1-3, `gap-audit/THEOKIT_GAP_AUDIT.md:66,115`) found that the **stateless** continuation path forces every server-style consumer to hand-roll history rebuild. The proof is first-party: `theocode/server/lib/continuation-history.ts` ships `buildContinuationHistory(base, events, maxChars)` + `continuationHistoryBudgetChars(contextWindowTokens)` because `defaultLlmStream` creates a FRESH agent per round, so the replayed history is the ONLY working memory the continued model has (it MUST carry tool-result CONTENT — EC-1 — and be bounded against the context window — EC-2).

M1 Phase 3 (`agent.runToCompletion`, released-pending in 2.2.x) covered the **stateful** path (the `LocalAgent` session preserves history across `send`s, so it only re-sends a short continuation prompt — confirmed at `packages/sdk/src/internal/agent-loop/loop-context-init.ts:105` where `priorMessages` come from session storage). M1-3 is the complementary **stateless** primitive: rebuild a bounded `StoredMessage[]` from `SDKMessage[]` when there is no live session.

The SDK already owns the load-bearing pieces:
- `truncateWithMarker(content, max)` — pure single-item truncation with marker (`packages/sdk/src/internal/runtime/context/context-loaders.ts:52`). To be REUSED (Unbreakable Rule 9 / DRY), not re-implemented.
- `StoredMessage` — durable envelope with `role: "user" | "assistant" | "system" | "tool_call" | "tool_result"` and `content` (`packages/sdk/src/types/conversation-storage.ts:23`). The natural OUTPUT type.
- `SDKMessage` discriminated union — stream events incl. `SDKAssistantMessage` and `SDKToolUseMessage` (emitted twice: `status:"running"` with `args`, then `status:"completed"|"error"` with `result`) (`packages/sdk/src/types/messages.ts:89,161`). The natural INPUT type.

This discovery exists to lock three open decisions before `/to-plan`, by comparing the field's strategies against the first-party hand-roll: (a) which `StoredMessage.role` to emit for tool turns (`tool_call`/`tool_result` per the contract vs the `assistant`/`user` overload theocode used because that path was honored); (b) the budget formula (theocode's `CHARS_PER_TOKEN=4` char heuristic vs a token-count strategy); (c) the trim policy (drop-oldest recency-wins + per-item truncation, keep ≥1).

Project rules honored: `architecture.md` §2 (pure domain primitive, no I/O — DIP), `testing.md` §3 (deterministic pure-function unit tests), `no-stubs-no-mocks-no-wired.md` (the primitive must have a real consumer path), Unbreakable Rule 9 (reuse `truncateWithMarker`, don't reinvent truncation).

## Objective

Produce a blueprint that lets us decide the exact contract of `buildReplayHistory` — input/output types, tool-turn role mapping, budget formula, per-item truncation rule, and trim policy — backed by both the field's mature compactors and the proven first-party hand-roll.

- [ ] All research questions answered with citations to `.claude/knowledge-base/reference/`
- [ ] Cross-cutting comparison table populated (ADK-JS vs CrewAI vs theocode hand-roll)
- [ ] Recommendations section provides one concrete decision proposal per open question (role mapping, budget formula, trim policy)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/reference/adk-js/` | `core/src/context/`, `core/test/context/`, `core/src/models/llm_request.ts` | Direct analog: `TruncatingContextCompactor` (drop-oldest) + `TokenBasedContextCompactor` (token threshold) + their tests + the strategy interface |
| `.claude/knowledge-base/reference/crewAI/` | `lib/crewai-core/src/crewai_core/token_manager.py` | Cross-language comparison of token budgeting/counting strategy |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/reference/codex/` | Its compaction is LLM-summarization + telemetry (`rollout-trace/src/compaction.rs`), not the deterministic event→bounded-history rebuild M1-3 targets |
| `.claude/knowledge-base/reference/opencode/` | Session compaction is DB/migration-driven full-session summarization, not a pure stateless rebuild primitive |
| `.claude/knowledge-base/reference/adk-js/**/dist/`, `node_modules/` | Build artifacts |
| LLM-summarization compaction in any ref | M1-3 is the DETERMINISTIC bounded rebuild; summarization is a separate (M2) concern |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** ADK-JS: 2h (primary analog), CrewAI: 1h (comparison only).

**Rationale:** ADK-JS ships the exact two-strategy shape M1-3 needs (truncating + token-based) WITH tests — deepest dive. CrewAI's `token_manager` is a single-file comparison point for the budget-formula ADR. Codex/opencode excluded (different problem — see out-of-scope).

**Alternatives considered:** equal split (rejected — ADK-JS is far richer); single-project ADK-JS only (rejected — CrewAI validates the char-vs-token budget choice cross-language).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants (pattern → kind-based → alternate path → broader scope), mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue. Do NOT pad with unrelated hotspots.

**Stop condition — per project (mandatory):** When a project's time budget is exhausted with N questions pending, mark them BLOCKED with reason "budget exhausted" and continue. If every remaining question across all projects is `done` or honestly `blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>` with the honest report — never `BLUEPRINT_COMPLETE` from a blocked state.

**Anti-pattern:** NEVER fabricate Fase B answers to close a Fase-A-exhausted question (Unbreakable Rule 3).

**Consequences:** the halt-loop stops per-project on budget exhaustion; blocked questions surface in the blueprint as next-discovery seed.

### D2 — Investigation depth

**Decision:** Read each ADK-JS compactor file end-to-end + its test file; Grep-then-Read for CrewAI `token_manager.py`.

**Rationale:** the compactor algorithm + its edge-case tests are the load-bearing evidence for the trim-policy and per-item ADRs; CrewAI only needs the token-counting strategy extracted.

**Consequences:** ADK-JS budget spent on full reads (≤6 files); CrewAI capped at the one file.

### D3 — First-party current-state is context, not a discover target

**Decision:** Treat `theocode/server/lib/continuation-history.ts` and the SDK primitives (`truncateWithMarker`, `StoredMessage`, `SDKMessage`) as already-known current state cited inline, NOT as `reference/` discovery questions.

**Rationale:** per `cycle-discover.md` ("Do NOT trigger DISCOVER for questions answered by reading your own code"), first-party code needs no discovery — it is read directly. The discovery's value is the EXTERNAL comparison that informs the open ADRs.

**Consequences:** research questions target only `reference/` projects; the blueprint's Recommendations synthesize external findings against the first-party baseline.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does ADK-JS `TruncatingContextCompactor` decide WHICH events to drop and which to preserve (recency? a preserved prefix?) when over budget? | techniques | `.claude/knowledge-base/reference/adk-js/core/src/context/truncating_context_compactor.ts`, `base_context_compactor.ts` | Read `truncating_context_compactor.ts` end-to-end; Grep `preserve`/`prefix`/`slice`/`splice` to locate the drop logic | Read the `compact()` body + the `BaseContextCompactor` interface | Prose + line cites: drop policy (oldest-first? preserved prefix?), keep-floor, mutation vs return |
| Q2 | How does ADK-JS `TokenBasedContextCompactor` ESTIMATE tokens and decide the threshold + `eventRetentionSize`? | techniques | `.claude/knowledge-base/reference/adk-js/core/src/context/token_based_context_compactor.ts` | Read end-to-end; Grep `token`/`estimate`/`count`/`encode`/`retention` | Read the token-count method + threshold check loop | Estimation method (heuristic vs tokenizer call), threshold formula, retention floor + line cites |
| Q3 | Do ADK-JS / CrewAI HAND-ROLL token/char budgeting or pull a tokenizer dependency (tiktoken/gpt-tokenizer)? | deps | `.claude/knowledge-base/reference/adk-js/core/src/context/`, `.claude/knowledge-base/reference/crewAI/lib/crewai-core/src/crewai_core/token_manager.py` | Grep `tiktoken`/`gpt-tokenizer`/`encode`/`import` across both; Read `token_manager.py` imports | Read the counting implementation + its imports in each | Per-project: hand-roll heuristic vs lib (name+version), with cites — informs SDK no-new-dep + reuse `truncateWithMarker` |
| Q4 | How does ADK-JS TEST the two compactors — which edge cases (over-budget, exactly-at-budget, single oversized item, retention floor) are asserted? | tests | `.claude/knowledge-base/reference/adk-js/core/test/context/truncating_context_compactor_test.ts`, `token_based_context_compactor_test.ts` | Read both test files; Grep `it(`/`describe(`/`expect(` to enumerate cases | Read each test case body to capture the asserted edge case | Table: test name → edge case → assertion — seeds the SDK's TDD RED cases |
| Q5 | What is ADK-JS's compaction INVOCATION CONTRACT (when/why `compact()` runs, and does it MUTATE context or RETURN a new value)? — extract only as input to the SDK's pure-vs-wired boundary decision; the SDK ships the PURE builder, runtime wiring is the consumer's job (EC-1) | tools | `.claude/knowledge-base/reference/adk-js/core/src/context/base_context_compactor.ts`, `.claude/knowledge-base/reference/adk-js/core/test/agents/processors/context_compactor_request_processor_test.ts` | Grep `ContextCompactor`/`processor`/`InvocationContext` to find the invocation site | Read the interface + processor test; capture mutate-vs-return + invocation timing | Invocation contract + an explicit mutate-vs-return divergence ADR (M1-3 = pure return, NOT in-place mutate) — informs the SDK pure-function boundary, NOT a runtime processor to ship |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q3 | Covered |
| Tools | Q5 | Covered |
| Techniques | Q1, Q2 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | every `.claude/knowledge-base/reference/{project}/{path}` declared in Fase A exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | Fase A returned ≥1 hotspot OR 3 query-variant retries attempted | After 3 retries empty, mark Qx BLOCKED "Fase A exhausted"; continue |
| After answering Qx | Blueprint section under Qx has ≥1 citation | Re-iterate Qx (1 retry max) |
| Per-project time budget | budget not exhausted | When exhausted, mark remaining Qx BLOCKED "budget exhausted"; advance |
| Before promising complete | all 4 coverage corners have populated sections | Refuse promise, continue iterating |
| Before answering Q1/Q2 (EC-2) | Fase B captured how ADK represents a TOOL TURN in its `Event` model (single vs split) | Record the shape; the role-mapping ADR MUST address the SDK's `SDKToolUseMessage` double-emission (`running`→`completed`) explicitly, not assume ADK's shape transfers |
| Reading Q2/Q3 token counting (EC-3) | captured whether ADK/CrewAI token counting is SYNC heuristic or ASYNC tokenizer call | If async, blueprint MUST flag that M1-3 stays SYNC + pure (theocode `CHARS_PER_TOKEN` char-heuristic reusing sync `truncateWithMarker`), deferring true-token counting |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/reference/{...}` path
- [ ] At least one ADR section in the blueprint synthesizes the role-mapping, budget-formula, and trim-policy decisions
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/m1-continuation-history-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → plan-confidence → execute → confidence → improve if needed)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one project rule principle (Rule 9 reuse `truncateWithMarker`; `architecture.md` §2 DIP pure primitive; `testing.md` §3 deterministic units)
