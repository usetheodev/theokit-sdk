---
slug: m1-continuation-history
created_at: 2026-06-20
goal: Ship a pure buildReplayHistory(base, events, options) in @theokit/sdk that rebuilds a bounded StoredMessage[] replay history from SDKMessage[] for the stateless continuation path, reusing truncateWithMarker, measured by tests/replay-history.test.ts passing green.
---

# Plan: M1-3 — Continuation-history rebuild (`buildReplayHistory`)

> **Version 1.1** (absorbed edge-case review `reviews/m1-continuation-history-edge-cases-2026-06-20.md`: EC-1 MUST-FIX non-finite-window guard added to T1.1; EC-2..EC-6 folded into T1.1 TDD; EC-7 documented) — Promote the proven first-party stateless continuation-history rebuild (`theocode/server/lib/continuation-history.ts`) into `@theokit/sdk` as a pure, dependency-free `buildReplayHistory` that serializes `SDKMessage[]` stream events into a bounded `StoredMessage[]` replay history, reusing the SDK's own `truncateWithMarker`. Closes roadmap gap M1-3 (the stateless complement to Phase-3 `runToCompletion`, which only covered the stateful session path). Design locked by blueprint `m1-continuation-history` (discover-confidence SHIPPABLE 99.7).

## Goal

> "Enable agent/server builders to rebuild a context-window-bounded replay history from persisted stream events on a fresh request so that the continued model keeps full working memory without a live session, measured by `tests/replay-history.test.ts` passing green."

## Context

Roadmap gap M1-3 (`gap-audit/THEOKIT_GAP_AUDIT.md:66,115`): the stateless continuation path forces every server-style consumer to hand-roll history rebuild. The proof is first-party — `theocode/server/lib/continuation-history.ts` ships `buildContinuationHistory(base, events, maxChars)` + `continuationHistoryBudgetChars(contextWindowTokens)` because a fresh agent per round makes the replayed history the only working memory, so it MUST carry tool-result content (EC-1) and be bounded against the context window (EC-2).

M1 Phase 3 (`agent.runToCompletion`) shipped the STATEFUL path: the `LocalAgent` session preserves history across `send`s (`packages/sdk/src/internal/agent-loop/loop-context-init.ts:105`), so the driver only re-sends a short prompt — `buildReplayHistory` is NOT needed there. M1-3 is the complementary STATELESS primitive for consumers that reconstruct context from stored events (server routes, serverless handlers).

Discovery (`knowledge-base/discoveries/blueprints/m1-continuation-history-blueprint.md`, SHIPPABLE 99.7) compared Google ADK-JS's `TruncatingContextCompactor` / `TokenBasedContextCompactor` and CrewAI's context-window handling against the theocode hand-roll, locking five ADRs (types, role mapping, trim policy + tool-pair safety, pure-return boundary, budget formula).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/runtime/context/replay-history.ts` (NEW) | 0 | — | (file to be created — the pure primitive) | — |
| `packages/sdk/src/internal/runtime/context/context-loaders.ts` | 122 | `2df50fa` (2026-06-07) | Holds `truncateWithMarker(content, max)` (line 52) — pure single-item truncation with marker | `truncateWithMarker` signature + `…[truncated by theokit]` marker behavior MUST stay; imported by `context-aggregator.ts` |
| `packages/sdk/src/types/conversation-storage.ts` | 81 | `d5f08e5` (2026-05-25) | Defines `StoredMessage` (line 23) — durable envelope w/ roles incl. `tool_call`/`tool_result` | `StoredMessage` shape MUST stay backward-compatible (it is `@public`) |
| `packages/sdk/src/types/messages.ts` | 170 | `478fe5a` (2026-06-07) | Defines `SDKMessage` union (line 161), incl. `SDKAssistantMessage`, `SDKToolUseMessage` (double-emitted) | union shape consumed read-only; no change |
| `packages/sdk/src/index.ts` | (barrel) | — | Public barrel re-exporting `@theokit/sdk` surface | additive export only; no removal |
| `packages/sdk/tests/replay-history.test.ts` (NEW) | 0 | — | (unit tests — RED first) | — |
| `packages/sdk/tests/replay-history-wiring.test.ts` (NEW) | 0 | — | (integration test through the public barrel) | — |
| `docs.md` | (contract) | — | Canonical public API contract (source of truth) | additive section only |
| `packages/sdk/CHANGELOG.md` + `.changeset/` (NEW entry) | — | — | Per-package changelog + changeset | additive `[Unreleased]`/changeset entry |

### Current callers / dependents

- **Symbol:** `truncateWithMarker(content, max)` in `context-loaders.ts:52` — REUSED (not modified).
  - **Callers (production):** `packages/sdk/src/internal/runtime/context/context-loaders.ts`, `packages/sdk/src/internal/runtime/context/context-aggregator.ts`
  - **External (public API consumed by other repos):** no (internal helper; this plan adds a NEW internal caller `replay-history.ts`)
- **Symbol:** `buildReplayHistory` (NEW) — no callers yet; ships as a PUBLIC primitive exported from the barrel (consumer-facing, like M0 `withRetry`/`mapWithConcurrency`/`safeFilenameForId`), wired via an integration test + docs example per the no-orphan public-primitive exception.
- **Symbol:** `StoredMessage`, `SDKMessage` — read-only inputs/outputs; not modified.

### Domain glossary

- **replay history** — a `StoredMessage[]` re-sent to a FRESH agent so a continued run keeps prior working memory (stateless continuation).
- **stateless continuation** — re-running an agent on a new request without a live session, reconstructing context from persisted stream events (vs Phase-3's stateful session re-send).
- **tool turn** — a tool call + its result; in the SDK a `SDKToolUseMessage` is emitted twice (`status:"running"` with `args`, then `status:"completed"|"error"` with `result`).
- **char budget** — the max total `content.length` the replay history may occupy, derived from the model's context window.
- **tool-pair safety** — never dropping a `tool_call` while keeping its orphan `tool_result` (or vice-versa) during trimming.

### Architecture boundaries affected

Per `rules/architecture.md` §2 (DIP): `replay-history.ts` is a PURE domain primitive — no I/O, no concrete-runtime imports; depends only on leaf types (`conversation-storage`, `messages`) + the existing pure helper `truncateWithMarker`. It crosses no layer outward. The only outward extension is an additive PUBLIC export from the barrel (a contract extension documented in `docs.md`).

## Prior Art & Related Work

- **Internal blueprint** `knowledge-base/discoveries/blueprints/m1-continuation-history-blueprint.md` §"Coverage Corner 4 — Techniques" and §"ADRs D1-D5" — the locked design source.
- **Reference project** ADK-JS `TruncatingContextCompactor` (`.claude/knowledge-base/reference/adk-js/core/src/context/truncating_context_compactor.ts:37-50`) — drop-oldest + preserved-prefix; and `TokenBasedContextCompactor` (`.claude/knowledge-base/reference/adk-js/core/src/context/token_based_context_compactor.ts:99-152`) — tool-pair split protection + `len/4` token heuristic.
- **First-party baseline** `theocode/server/lib/continuation-history.ts:15-69` — the proven hand-roll being promoted (drop-oldest, keep≥1, per-item truncate, `CHARS_PER_TOKEN=4`, 8k reserve).
- **SDK primitive** `packages/sdk/src/internal/runtime/context/context-loaders.ts:52` — `truncateWithMarker`, reused per Rule 9.

## Objective

- [ ] Pure `buildReplayHistory(base, events, options)` exists in `internal/runtime/context/replay-history.ts`, returning a new `StoredMessage[]`.
- [ ] Event mapping: assistant text → `assistant`; tool `running`→`tool_call`; tool `completed`/`error`→`tool_result` (carrying result); non-replayable events skipped.
- [ ] Trim: drop-oldest until ≤ char budget, keep ≥1, never split a tool pair; oversized single turn truncated via `truncateWithMarker` (not dropped).
- [ ] Budget: `(contextWindowTokens - reserveTokens) * 4`, sync, zero new deps.
- [ ] Exported from `@theokit/sdk` barrel + documented in `docs.md` + changeset.
- [ ] Wiring: integration test through the public surface + docs usage example (no-orphan public-primitive exception).
- [ ] `tests/replay-history.test.ts` + `tests/replay-history-wiring.test.ts` green; typecheck + Biome + knip clean.

## ADRs

### D1 — Input/output types: `SDKMessage[]` → `StoredMessage[]`

**Decision:** `buildReplayHistory(base: StoredMessage[], events: SDKMessage[], options): StoredMessage[]`.

**Rationale:** `StoredMessage` already reserves `tool_call`/`tool_result` roles for forward-compat (`conversation-storage.ts:23-25`) — the exact slots a replay history needs; `SDKMessage` is what a consumer accumulates from `run.stream()`. Reuses SDK-native types (Rule 9/DRY). Blueprint ADR D1.

**Alternatives considered:** custom event/history types (rejected — reinvents existing types); operate on `ConversationTurn` (rejected — that's the structured read-view, not the durable replay envelope).

**Consequences:** output feeds back as prior history; runtime wire-mapping of tool roles is the consumer's concern (documented).

### D2 — Tool-turn role mapping + double-emission collapse

**Decision:** assistant text → `assistant`; `SDKToolUseMessage{status:"running"}` (with `args`) → one `tool_call`; `SDKToolUseMessage{status:"completed"|"error"}` (with `result`) → one `tool_result` carrying result content; skip non-replayable events (system/thinking/status/task/request/object_delta/user-duplicate) and tool events lacking the relevant payload.

**Rationale:** `SDKToolUseMessage` is emitted twice (`messages.ts:89-99`); collapsing by status yields exactly one call + one result per `call_id`, matching theocode `eventToTurn` (`continuation-history.ts:25-41`) and ADK's call/response pairing. Tool-result content is working memory (EC-1). Blueprint ADR D2.

**Alternatives considered:** overload `assistant`/`user` like theocode (rejected — `StoredMessage` has dedicated honest roles); replay assistant `ToolUseBlock`s AND tool_call events (rejected — double counting).

**Consequences:** consumers feeding a user/assistant-only runtime must map the two tool roles (documented).

### D3 — Trim policy: drop-oldest + keep-floor + tool-pair safety + per-item truncation

**Decision:** drop OLDEST turns until total content ≤ char budget (keep ≥1); truncate (never drop) a single oversized turn via `truncateWithMarker` with `perItemCap`; never split a `tool_call` from its immediately-following `tool_result` when dropping (drop the pair together).

**Rationale:** drop-oldest + keep-floor is convergent (ADK `splice`, theocode `trimToBudget`). Tool-pair safety is ADK's documented invariant (`token_based_context_compactor.ts:99-113`) that theocode MISSES — an orphan tool turn corrupts replay. Per-item truncation reuses `truncateWithMarker` (Rule 9). Blueprint ADR D3.

**Alternatives considered:** drop newest (rejected — recency is what the model needs); LLM-summarize old turns (rejected — that's M2 compaction, not a pure primitive).

**Consequences:** trim is pair-aware (slightly more logic than theocode) but guarantees valid replay. A preserved leading prefix is deferred (YAGNI — theocode shipped without it).

### D4 — Pure return, not in-place mutation; no runtime processor

**Decision:** `buildReplayHistory` is a PURE sync function returning a new array; the SDK does NOT ship ADK's mutating `compact()` strategy or a request processor.

**Rationale:** audit specifies "Pure, sem deps"; `architecture.md` §2 (DIP, no I/O); pure functions are trivially unit-testable (`testing.md` §3). Blueprint ADR D4.

**Alternatives considered:** ship a mutating compactor + processor (rejected — scope creep, couples SDK to a session-event runtime); ship both (rejected — YAGNI, no second caller).

**Consequences:** zero runtime coupling; wiring caller is the consumer (integration test + docs example demonstrate it).

### D5 — Budget formula: char-budget from context window, sync, no tokenizer dep

**Decision:** `budgetChars = max(0, contextWindowTokens - reserveTokens) * CHARS_PER_TOKEN`, `CHARS_PER_TOKEN = 4`, `reserveTokens` configurable (default 8000); all sync.

**Rationale:** field-validated by ADK (`ceil(len/4)`) and theocode (`continuation-history.ts:18-23`); sync keeps the primitive pure and lets it reuse sync `truncateWithMarker`. Blueprint ADR D5.

**Alternatives considered:** real tokenizer (rejected — new dep, async, Rule 9/KISS); per-model catalog like CrewAI (rejected — maintenance burden, YAGNI).

**Consequences:** budget is approximate (a safety bound, not an exact fit); a precise-token variant can be added later if needed.

### D6 — Export from the main barrel `@theokit/sdk` (not a new subpath yet)

**Decision:** export `buildReplayHistory` + its option/result types from the main `@theokit/sdk` barrel.

**Rationale:** one small function does not justify a new subpath (KISS/YAGNI); mirrors `isTransientError` (barrel export). When M1-5's `./messages` subpath lands, `buildReplayHistory` MAY move there (it is a message/history reader) — noted as future, not now.

**Alternatives considered:** new `@theokit/sdk/replay` subpath (rejected — premature, one symbol); wait for `./messages` (rejected — M1-5 not built; would block M1-3).

**Consequences:** barrel grows by one symbol; a future move to `./messages` is a non-breaking re-export.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Char heuristic (`len/4`) is approximate — a model with a denser tokenizer could still overflow at the true token boundary | Medium | The budget is a SAFETY cap with a configurable `reserveTokens` (default 8k); document it as approximate; precise-token variant deferred (D5) | SDK |
| Tool roles (`tool_call`/`tool_result`) are not yet honored by the local replay wire-mapper (only user/assistant — `loop-context-init.ts:105`) | Medium | Document the consumer requirement on the public API; the function emits semantically-correct roles (D2); the stateless consumer (server) maps them to its own wire format | SDK |
| No internal SDK caller (pure consumer-facing primitive) risks knip flagging it | Low | Wire via the public-primitive exception (barrel export + integration test + docs example), exactly as M0 primitives did; knip honors barrel-exported public API | SDK |
| A single oversized `base` message exceeds budget (keep≥1 floor; base is not per-item truncated) — EC-7 | Low | Per-item truncation applies only to event-derived turns; truncating caller-owned durable `base` content would corrupt it. Documented in `docs.md` as a caller responsibility | SDK |

## Unresolved Questions

- (none — every decision is resolved at plan time via blueprint ADRs D1-D6. The tool-role wire-mapping gap is a documented consumer concern, not an open question for this primitive.)

## Dependencies

M1-3 introduces ZERO new dependencies — it is a pure in-memory transform that reuses the SDK's existing primitives and types (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (internal) `truncateWithMarker` | n/a (in-repo `context-loaders.ts:52`) | npm/TS | per-item truncation primitive — reused (Rule 9), no new dep |
| (internal) `StoredMessage` / `SDKMessage` types | n/a (in-repo `types/`) | npm/TS | I/O types — reused |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | — | — | Evaluated a tokenizer dep (`tiktoken`/`gpt-tokenizer`) for exact token counting and rejected it (blueprint D5): adds a dependency + async + per-model tables for a char-bounded SAFETY heuristic — violates Rule 9/KISS. The `len/4` heuristic is field-validated (ADK-JS) and reuses sync `truncateWithMarker`. | n/a — no new dep |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

> **Pre-existing workspace CVEs (out of scope for M1-3):** `pnpm audit` reports transitive HIGH findings (e.g. `undici <6.27.0` via `packages/memory-mem0 > mem0ai > @qdrant/js-client-rest`). These live in OTHER workspace packages, are NOT declared or introduced by this plan, and do not touch `@theokit/sdk`. Per `deps-audit-golden-rule.md`, hard caps apply to CVEs in DECLARED plan deps only; M1-3 declares none. Logged here for traceability; remediation belongs to a separate workspace-deps task.

## Dependency Graph

```
Phase 1 (pure core) ──▶ Phase 2 (export + wiring + docs) ──▶ Final Phase (integration validation)
```

Sequential: Phase 2 needs the core from Phase 1; Final validates both.

---

## Phase 1: Pure core `buildReplayHistory`

**Objective:** implement the pure, sync, dependency-free continuation-history rebuild with full TDD.

### T1.1 — Implement `buildReplayHistory` + helpers

#### Objective
Create `internal/runtime/context/replay-history.ts` with the pure `buildReplayHistory` plus pure helpers (event→StoredMessage mapping, char-budget, drop-oldest-with-tool-pair-safety trim).

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — introduces the new pure module: `buildReplayHistory(base, events, options)` mapping `SDKMessage[]`→`StoredMessage[]`, bounding by char budget, reusing `truncateWithMarker` for per-item caps.

2. **Why it is necessary now** — it is the whole deliverable; everything else (export, docs, wiring) depends on it. The algorithm is fully specified by ADRs D1-D5 (from the blueprint), so it can be written test-first without further discovery.

#### Evidence
Design source `.claude/knowledge-base/discoveries/blueprints/m1-continuation-history-blueprint.md` (ADRs D1-D5 + Coverage Corner 4 — Techniques). First-party baseline `theocode/server/lib/continuation-history.ts:15-69`. Reuse target `truncateWithMarker` at `packages/sdk/src/internal/runtime/context/context-loaders.ts:52`. Input union `SDKMessage` at `packages/sdk/src/types/messages.ts:161`; output `StoredMessage` at `packages/sdk/src/types/conversation-storage.ts:23`.

#### Files to edit
```
packages/sdk/src/internal/runtime/context/replay-history.ts — NEW: buildReplayHistory + pure helpers
packages/sdk/tests/replay-history.test.ts — NEW: RED tests first (TDD)
```

#### Deep file dependency analysis
- `replay-history.ts` (NEW) — imports `StoredMessage` (`conversation-storage.ts`), `SDKMessage`/`SDKToolUseMessage`/`SDKAssistantMessage` (`messages.ts`), and `truncateWithMarker` (`context-loaders.ts:52`). No other file changes in this task. No downstream caller yet (added in Phase 2).
- `truncateWithMarker` is REUSED unchanged — invariant preserved (Baseline Context row).

#### Deep Dives
- **Options type** `ReplayHistoryOptions { contextWindowTokens: number; reserveTokens?: number; perItemCap?: number }`. Defaults: `reserveTokens = 8000`, `perItemCap = floor(budgetChars / 2)`, `CHARS_PER_TOKEN = 4`.
- **Budget**: `budgetChars = max(0, (window - reserve)) * 4` where `window = Number.isFinite(contextWindowTokens) ? contextWindowTokens : 0` and `reserve = Number.isFinite(reserveTokens) ? reserveTokens : 8000` (D5 + EC-1 guard — a non-finite window MUST collapse to budget 0, never `NaN`, or the trim loop `total > NaN` silently returns an UNBOUNDED history). `perItemCap = max(0, opts.perItemCap ?? floor(budgetChars / 2))` (EC-6 guard — never negative).
- **Event mapping** (D2): iterate `events`; `assistant` → if text blocks non-empty, one `{role:"assistant", content:text}`; `tool_call` with `status:"running"` → `{role:"tool_call", content:"[tool_call <name>] <JSON args>"}`; `tool_call` with `status:"completed"|"error"` → `{role:"tool_result", content: perItemTruncated("[tool_result <name>] <result>")}`; everything else → skip.
- **Per-item truncation** (D3): apply `truncateWithMarker(content, perItemCap)` to each mapped turn's content so one giant result cannot blow the whole budget; never drop it.
- **Trim** (D3): concatenate `[...base, ...mappedTurns]`; while total `content.length > budgetChars` and length > 1, drop the OLDEST element — but if dropping a `tool_call` would orphan a following `tool_result` (or the element is a `tool_result` whose preceding `tool_call` was already dropped), drop the PAIR together; keep ≥1.
- **Invariants**: returns a NEW array (never mutates `base`/`events`); deterministic (no clock/RNG); empty `events` → returns `base` trimmed to budget; tool pair never orphaned.
- **Edge cases**: empty events; budget 0 (keep ≥1 newest, truncated); single oversized tool_result (truncate, keep); `contextWindowTokens - reserveTokens < 0` → budget 0.

#### Pseudo-code / Signatures
```pseudocode
function buildReplayHistory(base: StoredMessage[], events: SDKMessage[], opts): StoredMessage[]
  budgetChars = max(0, opts.contextWindowTokens - (opts.reserveTokens ?? 8000)) * 4
  perItemCap = opts.perItemCap ?? max(1, floor(budgetChars / 2))
  turns = []
  for ev in events:
    m = mapEvent(ev, perItemCap)         -- null for non-replayable
    if m != null: turns.push(m)
  return trimToBudget([...base, ...turns], budgetChars)   -- drop-oldest, pair-safe, keep>=1

# Example
input: base=[{role:"user",content:"do X"}], events=[asst("partial"), toolRun("read"), toolDone("read","<800 chars>")], {contextWindowTokens: 1000, reserveTokens: 900}
output: budgetChars=(1000-900)*4=400 → newest turns kept, oversized tool_result truncated with marker, user kept if it fits else dropped (keep>=1)
```

#### Tasks
1. Write RED tests in `tests/replay-history.test.ts`.
2. Implement `mapEvent` (pure) — D2 mapping.
3. Implement `charBudget` + `perItemCap` derivation — D5.
4. Implement `trimToBudget` with drop-oldest + tool-pair safety + keep≥1 — D3.
5. Implement `buildReplayHistory` composing the above; reuse `truncateWithMarker`.
6. REFACTOR for Biome cognitive-complexity ≤ 10 (extract helpers as needed).

#### TDD
```
RED: test_maps_assistant_text_to_assistant_role() — assistant event → {role:"assistant"}
RED: test_maps_tool_running_to_tool_call_and_completed_to_tool_result() — one of each per call
RED: test_skips_non_replayable_events() — system/thinking/status produce nothing
RED: test_returns_base_when_no_events() — events=[] → base (trimmed)
RED: test_drops_oldest_until_under_budget_keeps_at_least_one()
RED: test_truncates_oversized_single_turn_not_dropped() — giant tool_result truncated via marker, retained
RED: test_never_splits_tool_call_from_tool_result() — dropping orphans neither side
RED: test_budget_zero_when_reserve_exceeds_window() — keep>=1 newest
RED: test_is_pure_does_not_mutate_inputs() — base/events unchanged after call
RED: test_non_finite_context_window_collapses_to_zero_budget() — NaN/Infinity window → bounded (keep>=1, NOT unbounded) [EC-1]
RED: test_returns_empty_when_base_and_events_empty() — [] in → [] out (keep>=1 must not fabricate) [EC-2]
RED: test_skips_assistant_event_with_no_text_blocks() — only tool_use blocks → no assistant turn [EC-3]
RED: test_tool_result_with_undefined_result_yields_empty_content_not_string_undefined() [EC-4]
RED: test_drops_orphan_tool_result_without_crashing() — tool_result w/o preceding tool_call dropped alone [EC-5]
RED: test_perItemCap_zero_truncates_to_empty_marker_safely() — perItemCap 0/negative guarded [EC-6]
GREEN: implement replay-history.ts
REFACTOR: extract mapEvent/charBudget/trimToBudget; complexity <= 10
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/replay-history.test.ts
```

#### Concurrency tests
(none — single-threaded pure synchronous function; no shared mutable state, no async, no locks)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/replay-history.test.ts` reports 15/15 tests passed (9 core + 6 edge-case EC-1..EC-6)
- [ ] `test_non_finite_context_window_collapses_to_zero_budget` passes (EC-1: NaN/Infinity window → bounded, not unbounded)
- [ ] `test_is_pure_does_not_mutate_inputs` passes (returns a new array; base/events deep-equal pre-call snapshot)
- [ ] `test_never_splits_tool_call_from_tool_result` passes (no orphan tool turn in output)
- [ ] `grep -c "truncateWithMarker" packages/sdk/src/internal/runtime/context/replay-history.ts` returns ≥ 1 AND no `.slice(` per-item truncation is hand-rolled (reuse, not reinvent)
- [ ] `pnpm --filter @theokit/sdk exec biome check packages/sdk/src/internal/runtime/context/replay-history.ts` reports 0 errors (cognitive-complexity ≤ 10 enforced by Biome)
- [ ] `wc -l packages/sdk/src/internal/runtime/context/replay-history.ts` returns ≤ 150 (budget 500)

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/replay-history.test.ts` green
- [ ] `pnpm --filter @theokit/sdk typecheck` zero errors
- [ ] `pnpm --filter @theokit/sdk exec biome check` clean on changed files

---

## Phase 2: Public export + wiring + docs

**Objective:** expose `buildReplayHistory` as a public primitive with a real consumer path, docs, and changeset (no-orphan rule).

### T2.1 — Export, document, and wire `buildReplayHistory`

#### Objective
Export the function + types from the `@theokit/sdk` barrel, document it in `docs.md`, add a changeset + CHANGELOG entry, and prove the public surface with an integration test importing through the barrel.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds the barrel export, the `docs.md` contract section, a changeset/CHANGELOG entry, and an integration test that drives `buildReplayHistory` through the public surface with a realistic `SDKMessage[]` sequence.

2. **Why it is necessary now** — per `no-stubs-no-mocks-no-wired.md`, an exported symbol needs a real consumer path; per D4 the consumer IS the public API (like M0 primitives). Without the export + integration test + docs, the primitive is orphan code. CLAUDE.md mandates `docs.md` update in the same change for any public-surface change.

#### Evidence
`no-stubs-no-mocks-no-wired.md` §"Allowed exceptions: Public types intentionally exported for consumer use". M0 precedent: `withRetry`/`mapWithConcurrency`/`safeFilenameForId` shipped as public primitives (CHANGELOG `[Unreleased]`). Barrel at `packages/sdk/src/index.ts`. Contract at `docs.md`.

#### Files to edit
```
packages/sdk/src/index.ts — export buildReplayHistory + types from the barrel
packages/sdk/tests/replay-history-wiring.test.ts — NEW: integration test through the public surface
docs.md — NEW "Replay history (stateless continuation)" section
packages/sdk/CHANGELOG.md — [Unreleased] § Added entry
.changeset/m1-continuation-history.md — NEW: minor changeset
```

#### Deep file dependency analysis
- `index.ts` — additive `export` of `buildReplayHistory` + `ReplayHistoryOptions` (+ result is `StoredMessage[]`, already exported via `types/index.ts`). No removal; backward-compatible.
- `replay-history-wiring.test.ts` (NEW) — imports from `../src/index.js` (the barrel) and exercises a realistic event sequence end-to-end (the boundary the unit test's hand-built inputs mock).
- `docs.md` — additive section; no existing contract changed.

#### Deep Dives
- **Integration test**: build a realistic `SDKMessage[]` (assistant text + a running/completed tool pair) + a `base` `StoredMessage[]`, call `buildReplayHistory` via the barrel, assert: correct roles, tool-result content carried, budget respected, inputs unmutated. This crosses the public boundary the unit test bypasses (importing from `src/` per repo convention to avoid stale dist).
- **Invariant**: the public export name + signature is the contract — once documented in `docs.md`, changing it is a breaking change.

#### Tasks
1. Add barrel export in `index.ts`.
2. Write integration test `replay-history-wiring.test.ts` importing through the barrel.
3. Add `docs.md` section (signature + options + worked example + the tool-role consumer note).
4. Add `.changeset/m1-continuation-history.md` (minor) + CHANGELOG `[Unreleased] § Added`.

#### TDD
```
RED: test_buildReplayHistory_is_exported_from_barrel() — import { buildReplayHistory } from "../src/index.js" is a function
RED: test_rebuilds_bounded_history_from_realistic_event_stream() — assistant + tool pair → correct StoredMessage[] within budget, content carried
GREEN: add the barrel export
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/replay-history-wiring.test.ts
```

#### Concurrency tests
(none — single-threaded pure function exercised synchronously)

#### Acceptance Criteria
- [ ] `test_buildReplayHistory_is_exported_from_barrel` passes (`import { buildReplayHistory } from "../src/index.js"` resolves to a function)
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/replay-history-wiring.test.ts` reports 2/2 tests passed (realistic event stream → bounded history)
- [ ] `grep -c "buildReplayHistory" docs.md` returns ≥ 1 (signature + options + example + consumer tool-role note present)
- [ ] `ls .changeset/m1-continuation-history.md` exists AND `grep -c "buildReplayHistory" packages/sdk/CHANGELOG.md` ≥ 1
- [ ] `pnpm --filter @theokit/sdk exec biome check` reports 0 errors on changed files
- [ ] `pnpm quality:dead` reports 0 unused exports for `buildReplayHistory`

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/replay-history-wiring.test.ts` green
- [ ] `pnpm --filter @theokit/sdk typecheck` zero errors
- [ ] `pnpm --filter @theokit/sdk exec biome check` clean
- [ ] `pnpm quality:dead` clean

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Pure `buildReplayHistory` event→StoredMessage rebuild (M1-3) | T1.1 | New pure module, mapping per D1/D2 |
| 2 | Bounded by context window, reuse `truncateWithMarker` (Rule 9) | T1.1 | char-budget D5 + per-item truncation D3 |
| 3 | Drop-oldest + keep≥1 + tool-pair safety | T1.1 | `trimToBudget` D3 |
| 4 | Carry tool-result content (EC-1) | T1.1 | `tool_result` mapping D2 |
| 5 | Pure return, no mutation, no runtime processor (D4) | T1.1 | sync pure function + purity test |
| 6 | Public export + docs + no-orphan wiring | T2.1 | barrel export + integration test + docs.md + changeset |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk exec vitest run` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk exec biome check`
- [ ] Dead-code clean — `pnpm quality:dead` (knip)
- [ ] `wc -l packages/sdk/src/internal/runtime/context/replay-history.ts` returns ≤ 150 (budget 500)
- [ ] `grep -c "buildReplayHistory" packages/sdk/CHANGELOG.md` returns ≥ 1 AND `ls .changeset/m1-continuation-history.md` exists (Unbreakable Rule 6)
- [ ] `git diff main -- packages/sdk/src/index.ts` shows only ADDED export lines (zero removed/modified exports — backward compatible)
- [ ] `grep -c "buildReplayHistory" docs.md` returns ≥ 1 (public surface documented — source-of-truth rule)
- [ ] `test_is_pure_does_not_mutate_inputs` AND `test_never_splits_tool_call_from_tool_result` pass; `grep -c "truncateWithMarker" .../replay-history.ts` ≥ 1 (purity + tool-pair + reuse asserted)
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Failure scenarios

(none — no external I/O touched. `buildReplayHistory` is a pure in-memory transform: no HTTP, DB, queue, socket, or filesystem. Resilience-under-failure does not apply.)

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the primitive works through the public surface in a realistic workload, not just isolated units.

### Execution
```
pnpm --filter @theokit/sdk exec vitest run tests/replay-history.test.ts tests/replay-history-wiring.test.ts
pnpm --filter @theokit/sdk exec vitest run        # full suite — no regression
pnpm --filter @theokit/sdk typecheck
pnpm --filter @theokit/sdk exec biome check
pnpm quality:dead
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/replay-history.test.ts tests/replay-history-wiring.test.ts` reports all tests passed
- [ ] `pnpm --filter @theokit/sdk exec vitest run` reports 0 failed (full suite — no regression)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 (zero type errors)
- [ ] `pnpm --filter @theokit/sdk exec biome check` exits 0 (zero lint warnings)
- [ ] `pnpm quality:dead` exits 0 (knip: new public export not flagged as orphan)
- [ ] Runtime-metric proof — N/A documented: `buildReplayHistory` is a pure function with no runtime counter (consistent with M0 pure primitives `withRetry`/`mapWithConcurrency`)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description; they do not block.
