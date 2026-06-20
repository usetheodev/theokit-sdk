# Blueprint: M1-3 — Continuation-history rebuild (`buildReplayHistory`)

> **Version 1.0** — Synthesizes how Google ADK-JS bounds conversation history (`TruncatingContextCompactor`, `TokenBasedContextCompactor`) and how CrewAI handles context-window overflow, against the proven first-party hand-roll (`theocode/server/lib/continuation-history.ts`), to lock the contract for a pure `buildReplayHistory(base, events, { contextWindowTokens })` in `@theokit/sdk`. Decisions informed: tool-turn role mapping, budget formula, per-item truncation, trim policy (recency + tool-pair-safety), and the pure-vs-wired boundary.

**Slug:** `m1-continuation-history`
**Source plan:** `.claude/knowledge-base/discoveries/plans/m1-continuation-history-plan.md`
**Owner:** paulo
**Generated:** 2026-06-20 via `/discover-execute`
**Confidence verdict:** SHIPPABLE (99.7, discover-confidence 2026-06-20)

## Context

The stateless continuation path forces server-style consumers to hand-roll history rebuild (gap M1-3). The proof is first-party: `theocode/server/lib/continuation-history.ts` ships `buildContinuationHistory` because a fresh agent per round makes the replayed history the only working memory. M1 Phase 3 (`runToCompletion`) covered the stateful path; M1-3 is the complementary pure primitive. The SDK already owns `truncateWithMarker` (`packages/sdk/src/internal/runtime/context/context-loaders.ts:52`), `StoredMessage` (`packages/sdk/src/types/conversation-storage.ts:23`), and the `SDKMessage` union (`packages/sdk/src/types/messages.ts:161`).

## Objective

Decide the exact contract of `buildReplayHistory` — types, tool-turn role mapping, budget formula, per-item truncation, and trim policy — backed by mature compactors and the first-party hand-roll.

---

## Coverage Corner 1 — Integration Tests

### ADK-JS

How ADK-JS tests its context compactors:

- **TruncatingContextCompactor** asserts three edge cases (`.claude/knowledge-base/reference/adk-js/core/test/context/truncating_context_compactor_test.ts:51-99`):
  - `should not compact if under threshold` — `shouldCompact` returns `false` when `events.length (3) <= threshold (3)` (`:52-61`).
  - `should compact if over threshold` — drops the OLDEST, keeps the newest by id: after compacting `[1,2,3]` with `threshold:2`, survivors are `[2,3]` (`:63-77`).
  - `should preserve leading events` — with `preserveLeadingEvents:1`, `[1,2,3,4]` → `[1,3,4]`: the leading grounding event survives, the OLDEST-after-prefix is dropped (`:79-98`).
- **TokenBasedContextCompactor** uses a `MockSummarizer` to avoid an LLM call and exercises token counting + the tool-call/response split protection via `createMockEvent(id, tokenCount, isFuncCall, isFuncResp)` (`.claude/knowledge-base/reference/adk-js/core/test/context/token_based_context_compactor_test.ts:19-60`).

Code example (with citation):

```ts
// .claude/knowledge-base/reference/adk-js/core/test/context/truncating_context_compactor_test.ts:63-77
it('should compact if over threshold', () => {
  const compactor = new TruncatingContextCompactor({threshold: 2});
  const ctx = createDummyContext([e('1'), e('2'), e('3')]);
  expect(compactor.shouldCompact(ctx)).toBe(true);
  compactor.compact(ctx);
  expect(ctx.session.events.map(e => e.id)).toEqual(['2', '3']); // oldest dropped
});
```

These seed the SDK's TDD RED cases: under-budget no-op, drop-oldest recency, preserve-leading prefix, single-oversized-item truncation, tool-pair never split.

---

## Coverage Corner 2 — Dependencies

### ADK-JS

| Dependency | Version | Why | Citation |
|---|---|---|---|
| (none for token counting) | — | Token count is HAND-ROLLED: `usageMetadata.promptTokenCount ?? Math.ceil(contentStr.length / 4)` — NO tiktoken/gpt-tokenizer dep | `.claude/knowledge-base/reference/adk-js/core/src/context/token_based_context_compactor.ts:145-152` |

ADK-JS proves the field ships bounded-history compaction with a **4-chars-per-token heuristic and zero tokenizer dependency** — exactly theocode's `CHARS_PER_TOKEN = 4` (`theocode/server/lib/continuation-history.ts:15`).

### CrewAI

| Dependency | Version | Why | Citation |
|---|---|---|---|
| `litellm` (token counting) + per-model catalog | — | CrewAI does NOT char-heuristic; it keys a hardcoded per-model `context_window` catalog (e.g. `"gpt-4.1": 1047576`) and reacts to overflow | `.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/llm.py:174,2403` |

Contrast: CrewAI buys accuracy (real tokenizer + per-model catalog) at the cost of a dependency + model-table maintenance; ADK-JS buys zero-dep simplicity with a 4-char heuristic. For a PURE, sync SDK primitive that reuses `truncateWithMarker`, the ADK/theocode heuristic wins (KISS + Rule 9).

---

## Coverage Corner 3 — Tools

### ADK-JS

- **Strategy interface**: `BaseContextCompactor` declares `shouldCompact(ctx): boolean | Promise<boolean>` + `compact(ctx): void | Promise<void>` — "Compacts the context in place" (`.claude/knowledge-base/reference/adk-js/core/src/context/base_context_compactor.ts:12-29`).
- **Invocation contract**: compaction is a pluggable STRATEGY invoked by a request processor against an `InvocationContext`; `compact()` MUTATES `invocationContext.session.events` in place (`.claude/knowledge-base/reference/adk-js/core/src/context/truncating_context_compactor.ts:37-50`). A separate processor test exercises the wiring (`.claude/knowledge-base/reference/adk-js/core/test/agents/processors/context_compactor_request_processor_test.ts`).
- **Test runner**: Vitest (`describe`/`it`/`expect`) — same runner as `@theokit/sdk`.

**Boundary decision for the SDK (EC-1):** M1-3 ships the PURE builder that RETURNS a new `StoredMessage[]` — it does NOT mutate, and does NOT ship a runtime processor. The mutate-in-place strategy + processor wiring is the consumer's concern. This is the deliberate divergence from ADK's design (see ADR D4).

---

## Coverage Corner 4 — Techniques

### Technique 1 — Trim policy (which turns to drop when over budget)

| Project | Approach | Citation |
|---|---|---|
| ADK-JS Truncating | Drop OLDEST events after an optional preserved leading prefix: `events.splice(preserveLeadingEvents, excess)`; keep-floor = `threshold` | `.claude/knowledge-base/reference/adk-js/core/src/context/truncating_context_compactor.ts:37-50` |
| ADK-JS Token-based | Keep a tail of `eventRetentionSize` raw events; summarize the older prefix; **never split a tool call from its response** | `.claude/knowledge-base/reference/adk-js/core/src/context/token_based_context_compactor.ts:84-118` |
| theocode | Drop OLDEST until total `content.length <= maxChars`, keep ≥1 (recency wins) | `theocode/server/lib/continuation-history.ts:44-53` |

**Convergent finding:** recency wins (drop oldest), keep a floor (≥1). **ADK adds two ideas theocode lacks:** (a) an optional preserved LEADING prefix (grounding prompt survives trimming), and (b) **tool-call/tool-result pairing must never be split** (`token_based_context_compactor.ts:99-113`, `hasFunctionResponse(retain) && hasFunctionCall(prev) → extend retention`).

### Technique 2 — Per-item truncation (one giant result)

| Project | Approach | Citation |
|---|---|---|
| theocode | An oversized single `tool_result` is TRUNCATED (`raw.slice(0, perItemCap) + "…[truncated]"`), never DROPPED — it carries working memory (EC-1); `perItemCap = floor(maxChars/2)` | `theocode/server/lib/continuation-history.ts:30-34,66` |
| SDK primitive (to reuse) | `truncateWithMarker(content, max)` — pure, returns `{ truncated, finalContent }` with a `…[truncated by theokit]` marker | `packages/sdk/src/internal/runtime/context/context-loaders.ts:52-66` |

**Decision:** M1-3 reuses `truncateWithMarker` for the per-item cap instead of theocode's inline `slice` (Rule 9 / DRY).

### Technique 3 — Budget formula

| Project | Approach | Citation |
|---|---|---|
| ADK-JS | `tokens = usageMetadata.promptTokenCount ?? ceil(len/4)` | `.claude/knowledge-base/reference/adk-js/core/src/context/token_based_context_compactor.ts:145-152` |
| theocode | `budgetChars = max(0, contextWindowTokens - 8000) * 4` (reserve 8k tokens for system + continuation + reply) | `theocode/server/lib/continuation-history.ts:18-23` |

**Decision:** M1-3 adopts theocode's char-budget-from-context-window formula (sync, no tokenizer), reserving a configurable buffer; the 4-chars/token heuristic is field-validated by ADK.

---

## Cross-cutting Comparison

| Dimension | ADK-JS | CrewAI | theocode (first-party baseline) |
|---|---|---|---|
| Bounding unit | event count (truncating) / token est. (token-based) | per-model token catalog via litellm | char budget from context window |
| Token counting | hand-rolled `len/4`, no dep | litellm + hardcoded catalog | hand-rolled `len/4`, no dep |
| Trim policy | drop oldest + preserve leading prefix; tool-pair-safe | summarize or abort on overflow | drop oldest, keep ≥1 |
| Oversized item | (summarized) | (summarized) | truncate-not-drop (`slice`) |
| Mutation | in-place `splice`/`push` | n/a | returns new array (pure) |
| API shape | strategy class + processor | LLM-method-internal | pure function |

## ADRs

### D1 — Input/output types: `SDKMessage[]` → `StoredMessage[]`

**Decision:** `buildReplayHistory(base: StoredMessage[], events: SDKMessage[], opts): StoredMessage[]`. Input events are the SDK stream union; output is the durable envelope.

**Rationale:** `StoredMessage` already reserves `tool_call`/`tool_result` roles "for forward compat (ADR D310/EC-10)" (`packages/sdk/src/types/conversation-storage.ts:23-25`) — the exact slots a replay history needs; `SDKMessage` is the canonical event type a consumer accumulates from `run.stream()`. Mirrors theocode's `(base, events) → HistoryMessage[]` but on SDK-native types.

**Alternatives considered:** custom event/history types (rejected — reinvents `StoredMessage`/`SDKMessage`, violates DRY); operate on `ConversationTurn` (rejected — that's the structured read-view, not the durable replay envelope).

**Consequences:** the output feeds back as prior history; whether the runtime maps `tool_call`/`tool_result` roles to wire format is the consumer/runtime concern (the current local replay path honors `user`/`assistant` — `loop-context-init.ts:105`), so the function emits the semantically-correct roles and documents the consumer requirement.

### D2 — Tool-turn role mapping + double-emission collapse

**Decision:** map `SDKAssistantMessage` text → `assistant`; `SDKToolUseMessage{status:"running"}` (args) → a `tool_call` `StoredMessage`; `SDKToolUseMessage{status:"completed"|"error"}` (result) → a `tool_result` `StoredMessage` carrying the result content. Skip `running` duplicates that have no args and non-replayable events (system/thinking/status/task/request/object_delta/error).

**Rationale:** `SDKToolUseMessage` is emitted twice (`messages.ts:89-99` doc: running then completed). Collapsing by `status` yields exactly one `tool_call` + one `tool_result` per `call_id`, matching ADK's call/response pairing and theocode's `eventToTurn` (`continuation-history.ts:25-41`). Tool-result CONTENT is the working memory (EC-1) and must be carried.

**Alternatives considered:** overload `assistant`/`user` like theocode (rejected — `StoredMessage` has dedicated honest roles); replay the assistant message's `ToolUseBlock`s AND the tool_call events (rejected — double counting).

**Consequences:** consumers feeding a runtime that only honors user/assistant must map the two tool roles (documented); honest roles future-proof against the runtime gaining tool-role wire support.

### D3 — Trim policy: drop-oldest + keep-floor + tool-pair safety + per-item truncation

**Decision:** drop OLDEST turns until total content ≤ char budget (recency wins, keep ≥1); truncate (never drop) a single oversized turn via `truncateWithMarker` with `perItemCap`; **never split a `tool_call` from its following `tool_result`** when dropping.

**Rationale:** drop-oldest + keep-floor is convergent across ADK (`splice`) and theocode (`trimToBudget`). Tool-pair safety is ADK's documented invariant (`token_based_context_compactor.ts:99-113`) that theocode MISSES — a dropped `tool_call` leaving an orphan `tool_result` (or vice-versa) corrupts the replay. Per-item truncation reuses the SDK's `truncateWithMarker` (Rule 9).

**Alternatives considered:** drop newest (rejected — recency is what the continued model needs); summarize old turns (rejected — that's LLM-summarization compaction, M2 scope, not a pure primitive).

**Consequences:** the trim becomes pair-aware (slightly more logic than theocode), but guarantees a valid replay. Optional `preserveLeadingEvents`-style prefix is deferred (YAGNI — theocode shipped without it; revisit if a grounding-prompt need appears).

### D4 — Pure return, not in-place mutation; no runtime processor (EC-1)

**Decision:** `buildReplayHistory` is a PURE function returning a new array; the SDK does NOT ship ADK's mutating `compact()` strategy or a request processor.

**Rationale:** the audit specifies "Pure, sem deps"; `architecture.md` §2 (DIP, domain primitive, no I/O); pure functions are trivially unit-testable (`testing.md` §3). ADK's in-place `splice` + processor wiring is a framework-internal concern; the SDK exposes the algorithm, the consumer owns invocation.

**Alternatives considered:** ship a mutating compactor + processor like ADK (rejected — scope creep beyond a pure primitive, couples the SDK to a session-event runtime); ship both pure + wired (rejected — YAGNI, no second caller yet).

**Consequences:** zero runtime coupling; the wiring triad's caller is whatever continuation driver consumes it (e.g. a future stateless `runToCompletion` variant or a server route), demonstrated by an integration test.

### D5 — Budget formula: char-budget from context window, sync, no tokenizer dep

**Decision:** `budgetChars = max(0, contextWindowTokens - reserveTokens) * CHARS_PER_TOKEN` with `CHARS_PER_TOKEN = 4` and a configurable `reserveTokens` (default ~8000); all sync.

**Rationale:** field-validated by ADK (`ceil(len/4)`, `token_based_context_compactor.ts:149-151`) and theocode (`continuation-history.ts:18-23`); staying sync lets the primitive reuse the sync `truncateWithMarker` and remain pure (EC-3). CrewAI's litellm+catalog approach is more accurate but pulls a dep + model table (rejected for a KISS primitive).

**Alternatives considered:** real tokenizer (tiktoken/gpt-tokenizer) (rejected — new dep, async, Rule 9/KISS); per-model catalog like CrewAI (rejected — maintenance burden, YAGNI for a char-bounded heuristic).

**Consequences:** the budget is approximate (heuristic), acceptable because the cap is a safety bound not an exact fit; a future precise-token variant can be added if a consumer needs it.

## Recommendations for the project

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Ship `buildReplayHistory(base, events, { contextWindowTokens, reserveTokens?, perItemCap? })` as a pure function in a new `internal/runtime/context/replay-history.ts`, returning `StoredMessage[]` | Q1,Q5 · D1,D4 · architecture.md §2 | HIGH |
| 2 | Map events by D2 (assistant text / tool_call / tool_result via status), collapsing `SDKToolUseMessage` double-emission | Q1 · D2 | HIGH |
| 3 | Trim drop-oldest + keep-floor + **tool-pair safety** + per-item `truncateWithMarker` | Q1,Q2 · D3 · Rule 9 | HIGH |
| 4 | Budget = `(contextWindowTokens - reserveTokens) * 4`, sync, no tokenizer dep | Q2,Q3 · D5 · KISS | HIGH |
| 5 | TDD RED cases from ADK tests: under-budget no-op, drop-oldest, oversized-item truncate, tool-pair-not-split, keep≥1 | Q4 · testing.md §3 | HIGH |
| 6 | Expose via a public subpath OR `@theokit/sdk` barrel; wire a real caller + integration test (no-orphan rule) | Q5 · D4 · no-stubs-no-mocks-no-wired.md | MEDIUM |

## Blocked questions (if any)

| Question | Reason | Suggested human follow-up |
|---|---|---|
| Q3 (CrewAI sub-part) | `crewai-core/.../token_manager.py` is OAuth-token STORAGE (Fernet), NOT LLM token counting — name false-positive | Resolved via `crewai/llm.py:174,2403` (per-model context-window catalog) instead; ADK is the load-bearing dep evidence. No further action. |

## Halt-loop progress (audit trail)

- Iterations used: 1 (inline per-iteration contract; bounded read-and-synthesize)
- Questions answered: 5 / 5
- Questions blocked: 0 (1 sub-part re-sourced, see above)
- Citations verified: all `.claude/knowledge-base/reference/` paths confirmed on disk (Step 7 sanity check)
- Promise emitted: `<promise>BLUEPRINT_COMPLETE</promise>`

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/m1-continuation-history-plan.md`
- Edge-case review: `.claude/knowledge-base/reviews/m1-continuation-history-edge-cases-2026-06-20.md`
- Confidence report: `.claude/knowledge-base/reviews/m1-continuation-history-confidence-2026-06-20.md` (generated by `/discover-confidence`)
- Project rules: `.claude/rules/architecture.md`, `.claude/rules/testing.md`, `.claude/rules/no-stubs-no-mocks-no-wired.md`
