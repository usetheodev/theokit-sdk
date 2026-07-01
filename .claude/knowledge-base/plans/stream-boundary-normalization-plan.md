# Plan: Stream-Boundary Leaked-Dialect Suppression (R7)

> **Version 1.1** (2026-07-01 — absorbed 1 MUST-FIX + 2 SHOULD-TEST from `.claude/knowledge-base/reviews/stream-boundary-normalization-edge-cases-plan-2026-07-01.md`: EC-1 the FSM marker match is CASE-SENSITIVE to agree with the `HERMES_BLOCK` regex; EC-2 terminal chunk carrying content+finish_reason; EC-3 R5 accumulator tests stay green under holding) — Make `OpenAIStreamAccumulator` HOLD BACK `text_delta` events for content that could still be a `<function=NAME>` tool call for a request tool (a 2-state suppression FSM over a suspicion buffer, reusing R5's `allowedToolNames` Set + a new prefix probe), and flush the buffer's residual at the terminal chunk — so the raw leaked dialect is never streamed to the user (neither live via `onDelta` nor in the loop's `accumulatedText`-derived final text), while `finish()` (R5 recovery) keeps doing the actual tool-call promotion. Gated by the existing `extractToolCallsFromContent` flag; flag-off streams byte-for-byte as today. Grounded in the `stream-boundary-normalization` blueprint (SHIPPABLE_WITH_CAVEATS 89.0).

## Goal

> "Enable the SDK's OpenAI-compat streaming to suppress a leaked `<function=NAME>` tool-call from the visible `text_delta` stream when `NAME` is a request tool, measured by the new golden test `test_flag_on_leaked_call_is_not_streamed_as_text` asserting the collected `text_delta` events contain no `<function=` while `finish.toolCalls` still recovers the call."

## Context

R7 = recommendation #7 / technique T1 of `.claude/knowledge-base/discoveries/blueprints/tool-calling-robustness-blueprint.md`, gated on R5 (`@theokit/sdk@2.15.1`) + R6 (`@theokit/sdk@2.15.0`), both shipped. Today `OpenAIStreamAccumulator.applyContentDelta` (`packages/sdk/src/internal/llm/openai.ts:273-277`) emits every `text_delta` immediately; the loop accumulates them (`packages/sdk/src/internal/agent-loop/loop-llm-stream.ts:200` `accumulatedText += next.value.text`) and derives the final assistant text from that accumulation (`loop-llm-stream.ts:109-111` `stripThinkBlocks(collected.accumulatedText).visible` — `finish.text` is NOT used for the text field). So the raw `<function=…>` dialect both flashes by live (via `onDelta`) AND lands in the final text, even though `finish()` (`openai.ts:308`, R5) recovers the call and strips it from `finish.text`. R7 holds the suspected dialect back at the stream boundary. Per the blueprint's ADR D1, we do NOT port openclaw's mid-stream promotion — `finish()` already promotes; R7 is a suppression layer only.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/llm/hermes-tool-extract.ts` | 121 | `17f2617` (2026-07-01) | Pure leaked-dialect recovery (R5 gate + residual) | `extractHermesToolCalls` signature + behavior unchanged; the new FSM helper is additive + pure |
| `packages/sdk/src/internal/llm/openai.ts` | 518 | `17f2617` (2026-07-01) | OpenAI-compat client + `OpenAIStreamAccumulator` (streaming emit + finish recovery) | `this.text` accumulation stays whole (finish recovery input); flag-OFF path emits `text_delta` immediately (byte-for-byte as today); native tool_calls path untouched |
| `packages/sdk/tests/internal/llm/hermes-tool-extract.test.ts` | 249 | `17f2617` (2026-07-01) | Unit + accumulator integration tests | existing cases stay green |
| `packages/sdk/tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts` | 185 | `17f2617` (2026-07-01) | End-to-end SSE → accumulator → finish | flag-OFF + native-win tests stay green |

### Current callers / dependents

- **Symbol:** `OpenAIStreamAccumulator.applyContentDelta` / `consume` (`openai.ts:231,273`) — `consume()` called only from `stream()` (`openai.ts:198`); `applyContentDelta` only from `consume` (`:241`).
- **Symbol:** `extractHermesToolCalls` (`hermes-tool-extract.ts:59`) — production caller `openai.ts:309` (finish recovery); the NEW pure FSM helper will be a sibling export used by the accumulator.
- **Consumer of `text_delta` events:** `loop-llm-stream.ts:199-201` (accumulates into `accumulatedText`, forwards to `onDelta`). NOT modified — holding deltas transparently reduces `accumulatedText`.
- **External (public API):** none — all `@internal`. No public type or `docs.md` contract change (the suppression is automatic behavior of the existing `extractToolCallsFromContent` flag).

### Domain glossary

- **Suspicion buffer** — accumulated streamed content that could still be building toward a `<function=NAME>` tool call; held (not emitted as `text_delta`) until resolved.
- **Suppress / hold** — do not emit a `text_delta` for the buffered content (state "possible").
- **Flush** — emit the buffered content as a `text_delta` (state "impossible" — confirmed not a tool call).
- **Terminal residual flush** — at the chunk carrying `finish_reason`, emit the held buffer minus complete recoverable tool-call blocks, so `accumulatedText == finish.residualText`.
- **`accumulatedText`** — the loop's running sum of `text_delta` texts (`loop-llm-stream.ts:200`); the source of the final assistant text.

### Architecture boundaries affected

`rules/architecture.md`: the pure FSM predicate lives in `hermes-tool-extract.ts` (llm/infra, request-blind — receives the allowlist as data); the accumulator (`openai.ts`) owns the stateful buffer + calls the pure FSM. No new cross-layer import; `openai.ts` stays under the same adapter. Keeping the FSM in `hermes-tool-extract.ts` avoids growing `openai.ts` (already 518 LoC) past budget with pure logic.

## Prior Art & Related Work

- **Internal blueprint** — `.claude/knowledge-base/discoveries/blueprints/stream-boundary-normalization-blueprint.md §"Coverage Corner 4" / ADR D1, D2, D3` (suppression-only, R5-Set + prefix probe, small cap + fail-open).
- **Reference project** — openclaw `stream-normalizer.ts`: the 3-state `getPlainTextToolCallBufferState` (`.claude/knowledge-base/references/openclaw/packages/tool-call-repair/src/stream-normalizer.ts:339-360`), the xmlish predicate (`:155-186`), the buffered-split-marker test (`.claude/knowledge-base/references/openclaw/src/plugin-sdk/provider-stream-shared.test.ts:2097`).
- **Prior R's reused** — R5 (`@theokit/sdk@2.15.1`) `allowedToolNames` Set + `finish()` recovery; R6 (`@theokit/sdk@2.15.0`).
- No `*-patterns` skill matches this topic.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none new) | — | npm | R7 is plain string scanning over the platform `Set<string>`; openclaw ships the same FSM with `dependencies: {}` (`tool-call-repair/package.json`). |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | A 2-state buffer FSM over a string is a spec-adjacent one-liner cluster; a dependency would violate parsimony (Rule 9 / KISS). openclaw's is dep-free. | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Objective

- [ ] A pure `streamToolCallBufferState(held, allowedToolNames)` returns `"possible"` (buffer could still become a `<function=NAME>` tool call for an allowed tool) or `"impossible"` (flush as text), reusing an exact + prefix probe over the Set.
- [ ] `OpenAIStreamAccumulator` holds `text_delta` for `"possible"` buffers and flushes on `"impossible"`; at the terminal chunk it flushes the held buffer's residual (held minus complete recovered blocks) so `accumulatedText` equals the clean final text.
- [ ] Gated by `extractFromContent`: flag-OFF emits `text_delta` immediately (byte-for-byte as today).
- [ ] `finish()` recovery (R5) is unchanged and remains the sole tool-call promotion path.
- [ ] Fail-open: any buffer that cannot be cleanly suppressed (e.g. prose+marker mixed in one delta, a never-closing marker over the cap) is flushed as visible text — never held forever, never a hang (no regression vs today).

## ADRs

### D1 — Suppression-only FSM in the accumulator; `finish()` (R5) keeps promotion; `this.text` stays whole

**Decision:** `applyContentDelta` appends to `this.text` (unchanged) AND to a suspicion buffer; while `streamToolCallBufferState(buffer) === "possible"` it returns no `text_delta` (hold); on `"impossible"` it flushes the buffer as a `text_delta`. At the `finish_reason` chunk it flushes the buffer's residual. `finish()` recovery is untouched.

**Rationale:** the loop derives the final text from `accumulatedText` (`loop-llm-stream.ts:109-111`), so holding `text_delta` events alone makes both the live `onDelta` view AND the final text clean — no loop change. `finish()` already promotes (R5); a second mid-stream promotion path would risk divergence (blueprint D1). `this.text` staying whole means `finish()`'s R5 gate+strip work exactly as today (`rules/architecture.md`, `rules/parsimony-ladder`).

**Alternatives considered:** (a) full openclaw port with mid-stream `createPromotedToolCallEvents` — rejected (second promotion path + 3-dialect machinery we don't need); (b) change the loop to use `finish.text` — rejected (broader blast radius: `stripThinkBlocks` + all providers).

**Consequences:** `applyContentDelta` becomes stateful; some `consume()` calls emit no `text_delta` (holding) and later flush; a terminal residual flush keeps `accumulatedText == finish.residualText`.

### D2 — The matcher is R5's `allowedToolNames` Set + a prefix probe

**Decision:** the FSM's "could still be `<function=NAME>`" predicate uses `allowedToolNames.has(name)` (exact, R5) plus `hasNamePrefix(partial) = [...allowedToolNames].some(n => n.startsWith(partial))` (new — the streamed name arrives partially).

**Rationale:** during streaming the name arrives token-by-token; a prefix probe over the tiny request tool-set is negligible cost and keeps R5+R7 on one source of truth for "is this a real request tool" (DRY, blueprint D2). No new data structure.

**Alternatives considered:** a trie — rejected (YAGNI; request tool-sets are tiny).

**Consequences:** a leaked marker for a non-tool name is flushed the instant its partial name can no longer prefix any request tool.

### D3 — Small buffer cap; fail-open flush on over-cap / un-suppressable input

**Decision:** cap the suspicion buffer at a small KB-scale limit; on over-cap (a marker that never closes) OR any input the FSM cannot cleanly hold, FLUSH the buffered text as visible `text_delta`.

**Rationale:** our `<function=…></tool_call>` blocks are tiny; a small cap bounds a pathological non-closing marker (`rules/error-handling.md` — fail-open to visible text, never hang). Mirrors openclaw's over-cap-flush intent (`stream-normalizer.ts:354-360`) at our scale.

**Alternatives considered:** openclaw's 256k — rejected (oversized); no cap — rejected (unbounded buffer / hang risk).

**Consequences:** a legitimately huge non-tool text starting with `<function=<allowed-name>` that never closes is flushed after the cap (visible) — extremely rare, safe, no regression.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Streaming is a hot path; a per-delta FSM check adds cost | Low | The FSM short-circuits: a buffer not starting with `<function=` is `"impossible"` immediately (one `startsWith` check) → flush; buffering only engages for actual `<function=` starts. Only active when `extractFromContent` is on (opt-in routes). | plan |
| A delta mixing prose + `<function=` marker in ONE delta streams as text (fail-open), not suppressed | Low | Documented limitation; `finish()` still recovers the call (no regression vs today). v1 scopes to the common case (marker at content start / after newline). | plan |
| Terminal residual flush must keep `accumulatedText == finish.residualText` or the final text drifts | Medium | A dedicated integration test asserts the collected `text_delta` concatenation equals `finish`'s stripped text for held-then-recovered and held-then-flushed cases. | plan |
| `openai.ts` already 518 LoC (over the 500 soft budget) | Low | The pure FSM lives in `hermes-tool-extract.ts`; `openai.ts` gains only the thin buffer glue (~25 lines). Note the pre-existing overage. | plan |

## Unresolved Questions

- Q1 — What exact cap value? Resolved at plan time: a small constant (e.g. 8 KB) — far above any real `<function=…></tool_call>` yet bounding a pathological marker. (none further — resolved at plan time.)

## Dependency Graph

```
Phase 1 ──▶ T1.1 (pure FSM predicate) ──▶ T2.1 (accumulator buffering + terminal flush) ──▶ Phase 2 (Integration Validation)
```

T2.1 depends on T1.1. Sequential.

---

## Phase 1: Stream suppression

**Objective:** add the pure "could still be a tool call" FSM, then make the accumulator hold/flush on it.

### T1.1 — Pure `streamToolCallBufferState` FSM predicate

#### Objective
A pure function that classifies a suspicion buffer as `"possible"` (hold) or `"impossible"` (flush), using an exact + prefix match over the request allowlist.

#### Why this step (action + reasoning)

**What this step does** — adds `streamToolCallBufferState(held: string, allowedToolNames: ReadonlySet<string>, cap?: number): "possible" | "impossible"` to `hermes-tool-extract.ts`, implementing the xmlish "could still be `<function=NAME>`" check (marker prefix → partial-name prefix-match → complete-name exact-match → payload still building) + the over-cap flush.

**Why it is necessary now** — the accumulator (T2.1) needs a PURE, unit-testable decision it can call per delta without transport; putting it in `hermes-tool-extract.ts` co-locates it with the extraction + allowlist and keeps `openai.ts` from growing (`rules/architecture.md` DIP, `rules/parsimony-ladder`).

#### Evidence
openclaw `getPlainTextToolCallBufferState` (`.claude/knowledge-base/references/openclaw/packages/tool-call-repair/src/stream-normalizer.ts:339-360`) + `couldStillBeXmlishFunctionToolCall` (`:155-186`); our marker regex `hermes-tool-extract.ts:39` (`<function=\s*([^>\s]+)`); R5 allowlist `hermes-tool-extract.ts:64-71`.

#### Files to edit
```
packages/sdk/src/internal/llm/hermes-tool-extract.ts — add streamToolCallBufferState (+ a prefix probe helper)
packages/sdk/tests/internal/llm/hermes-tool-extract.test.ts — RED tests first
```

#### Deep file dependency analysis
- `hermes-tool-extract.ts` (Baseline row 1) — gains a sibling pure export; `extractHermesToolCalls` untouched. Consumer = the accumulator (T2.1).

#### Deep Dives
- **Signature:** `streamToolCallBufferState(held, allowedToolNames, cap = 8192): "possible" | "impossible"`.
- **Logic:** `const t = held.trimStart();` marker is `<function=`. EC-1: match it CASE-SENSITIVELY (NO `.toLowerCase()`) so the FSM agrees exactly with the case-sensitive `HERMES_BLOCK` regex (`hermes-tool-extract.ts:39`) — the FSM must never hold a block the extractor won't recover. If `t.length <= "<function=".length` → `"<function=".startsWith(t) ? "possible" : "impossible"` (still building the marker). Else if `!t.startsWith("<function=")` → `"impossible"`. Read the (partial) name: complete `>` seen → require `allowedToolNames.has(name)` else `"impossible"`; still partial → require some allowed name `startsWith(name)` else `"impossible"`; if it could still complete → `"possible"`. `held.length > cap` while still possible → `"impossible"` (fail-open flush).
- **Invariant:** a buffer that is NOT building `<function=<allowed>` returns `"impossible"` (so normal prose flushes immediately). Empty allowlist → always `"impossible"` (nothing to suppress).
- **Edge cases:** partial marker `"<fun"` (prefix of `<function=`) → `"possible"` (still building the marker); `"<function=notatool"` → `"impossible"`; complete `<function=read>...` (read allowed) → `"possible"`; over-cap → `"impossible"`.

#### Pseudo-code / Signatures
```pseudocode
function streamToolCallBufferState(held, allowed, cap=8192):
  t = held.trimStart()
  if allowed.size == 0: return "impossible"
  if t.length <= "<function=".length:
     return "<function=".startsWith(t.toLowerCase()) ? "possible" : "impossible"   # still building the marker
  if not t.toLowerCase().startsWith("<function="): return "impossible"
  name = <chars after "<function=" up to > or end>
  complete = (char after name == ">")
  ok = complete ? allowed.has(name) : someAllowedStartsWith(name)
  if not ok: return "impossible"
  if held.length > cap: return "impossible"    # fail-open (D3)
  return "possible"

# Example
allowed={read_file}: "<function=rea"  -> "possible" (rea prefixes read_file)
allowed={read_file}: "<function=xyz"  -> "impossible"
allowed={read_file}: "hello world"    -> "impossible" (flush normal prose)
```

#### Tasks
1. Add `someAllowedStartsWith` (or inline `.some(startsWith)`) + `streamToolCallBufferState`.
2. Handle the partial-marker (`<fun`), partial-name, complete-name, over-cap, empty-allowlist cases.
3. JSDoc documenting hold/flush semantics + the fail-open cap.

#### TDD
```
RED: test_state_impossible_for_normal_prose() — "hello", allowed={read} -> "impossible"
RED: test_state_possible_for_partial_marker() — "<fun", allowed={read} -> "possible"
RED: test_state_possible_for_partial_allowed_name() — "<function=rea", allowed={read_file} -> "possible"
RED: test_state_impossible_for_unallowed_name() — "<function=xyz", allowed={read} -> "impossible"
RED: test_state_possible_for_complete_allowed_open() — "<function=read>", allowed={read} -> "possible"
RED: test_state_impossible_for_complete_unallowed() — "<function=read>", allowed={write} -> "impossible"
RED: test_state_impossible_empty_allowlist() — "<function=read>", allowed=new Set() -> "impossible"
RED: test_state_impossible_over_cap() — "<function=read>" + 9000 chars, allowed={read}, cap=8192 -> "impossible"
RED: test_state_impossible_for_wrong_case_marker (EC-1) — "<Function=read>", allowed={read} -> "impossible" (case-sensitive, matches HERMES_BLOCK; the extractor would not recover it)
GREEN: implement streamToolCallBufferState (case-sensitive marker)
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/internal/llm/hermes-tool-extract.test.ts
```

#### Concurrency tests

(none — single-threaded)

Pure function over its arguments; no shared state.

#### Acceptance Criteria
- [ ] All 8 RED tests pass GREEN via `vitest run tests/internal/llm/hermes-tool-extract.test.ts`
- [ ] `pnpm --filter @theokit/sdk exec biome check src/internal/llm/hermes-tool-extract.ts` reports 0 diagnostics
- [ ] `wc -l src/internal/llm/hermes-tool-extract.ts` returns < 500
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/internal/llm/hermes-tool-extract.test.ts` exits 0
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 AND biome 0 diagnostics on the file
- [ ] `grep -c "R7\|stream" CHANGELOG.md` returns ≥ 1 under `[Unreleased]`

### T2.1 — Accumulator buffering + terminal residual flush

#### Objective
Make `OpenAIStreamAccumulator` hold `text_delta` while the suspicion buffer is `"possible"`, flush on `"impossible"`, and flush the residual at the `finish_reason` chunk — gated by `extractFromContent`.

#### Why this step (action + reasoning)

**What this step does** — `applyContentDelta` appends to `this.text` (unchanged) and, when `extractFromContent && allowedToolNames.size > 0`, to a `#heldText` buffer; it returns a `text_delta` only when `streamToolCallBufferState(#heldText, allowedToolNames) === "impossible"` (flush the whole buffer, clear it), else `undefined` (hold). `consume()` detects the `finish_reason` chunk and, if `#heldText` is non-empty, emits `extractHermesToolCalls(#heldText, …, allowedToolNames).residualText` as a final `text_delta` (the held tail minus complete recovered blocks). `finish()` is unchanged.

**Why it is necessary now** — this is the wiring that realizes the blueprint's suppression (ADR D1); it reuses T1.1's pure FSM + R5's `finish()` recovery, with the terminal flush keeping `accumulatedText == finish.residualText`.

#### Evidence
`openai.ts:273-277` (`applyContentDelta`), `:231-247` (`consume`), `:244` (`applyFinishReason`), `:308-317` (finish recovery); `this.allowedToolNames` (R5, `openai.ts:228`); openclaw's per-delta gate (`stream-normalizer.ts:1182-1204`) + done-seam (`:1218-1232`).

#### Files to edit
```
packages/sdk/src/internal/llm/openai.ts — #heldText buffer; applyContentDelta hold/flush; consume terminal residual flush
packages/sdk/tests/internal/llm/hermes-tool-extract.test.ts — RED accumulator tests (via __testing__OpenAIStreamAccumulator)
packages/sdk/tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts — RED golden stream tests
```

#### Deep file dependency analysis
- `openai.ts` (Baseline row 2) — `applyContentDelta` gains buffering; `consume` gains a terminal-flush branch; a `#heldText` field. `finish()` unchanged (still recovers over `this.text`). Downstream `loop-llm-stream.ts` unchanged (fewer/held `text_delta` events transparently reduce `accumulatedText`).

#### Deep Dives
- **Field:** `private heldText = ""`.
- **`applyContentDelta(content)`:** `this.text += content`. If `!(this.extractFromContent && this.allowedToolNames && this.allowedToolNames.size > 0)` → return `{type:"text_delta", text: content}` (old path, no buffering). Else `this.heldText += content`; if `streamToolCallBufferState(this.heldText, this.allowedToolNames) === "impossible"` → `const flushed = this.heldText; this.heldText = ""; return {type:"text_delta", text: flushed}`; else return `undefined` (hold).
- **`consume` terminal:** after `applyFinishReason(choice.finish_reason)`, if `choice.finish_reason != null && this.heldText.length > 0` → `const residual = extractHermesToolCalls(this.heldText, makeId, this.allowedToolNames).residualText; this.heldText = ""; if (residual.length > 0) events.push({type:"text_delta", text: residual})`. (finish() recovers the tool calls from `this.text`.)
- **Invariant:** `this.text` whole (finish recovery unchanged); flag-OFF → immediate emit (byte-for-byte). `accumulatedText` (sum of emitted text_delta) == `finish.residualText`.
- **Edge cases:** held tail is a complete recovered call → residual `""` → no final text_delta (call hidden). Held tail is leftover prose → flushed as residual. Never-closing marker → over-cap → flushed mid-stream.

#### Tasks
1. Add `private heldText = ""`.
2. Rewrite `applyContentDelta` with the gate + hold/flush.
3. Add the terminal residual flush in `consume` on `finish_reason`.
4. Golden + accumulator RED tests.

#### TDD
```
RED: test_accumulator_holds_leaked_call_emits_no_text_delta — flag on, allowed={shell_exec}, stream a split <function=shell_exec>…</tool_call> -> consume() returns NO text_delta; finish recovers 1 call
RED: test_accumulator_flushes_normal_prose_immediately — flag on, allowed={shell_exec}, stream "hello " -> text_delta "hello " emitted (impossible)
RED: test_accumulator_flushes_unallowed_marker_as_text — flag on, allowed={other}, stream <function=shell_exec>… -> flushed as text_delta (impossible), finish recovers 0
RED: test_accumulator_terminal_residual_flush_equals_finish_text — flag on, "<function=shell_exec>…</tool_call> bye" -> accumulated text_delta === finish.text ("bye"), 1 call recovered
RED: test_accumulator_flag_off_streams_immediately — flag off -> every delta emitted immediately (byte-for-byte)
RED: test_accumulator_terminal_chunk_with_content_and_finish_reason (EC-2) — one chunk carries the closing </tool_call> content AND finish_reason:"stop" -> content appended to heldText BEFORE the residual flush; the complete block is recovered, residual empty
RED: test_accumulator_held_block_still_recovered_by_finish (EC-3) — a HELD (not streamed) <function=shell_exec>…</tool_call> is still recovered by finish (finish reads this.text, unaffected by holding) — guards the R5 accumulator suite under R7
RED (golden): test_flag_on_leaked_call_is_not_streamed_as_text — full SSE, REQUEST.tools=[shell_exec], leaked block split across frames -> collected text_delta events contain no "<function="; finish.toolCalls length 1
GREEN: implement the buffer + terminal flush
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/internal/llm/hermes-tool-extract.test.ts tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts
```

#### Concurrency tests

(none — single-threaded)

`OpenAIStreamAccumulator` is per-`stream()` instance; `heldText` is instance state read/written only in the single-threaded consume loop.

#### Acceptance Criteria
- [ ] All 6 RED tests pass GREEN via the two vitest files
- [ ] Existing flag-OFF + native-win golden tests stay green in the same run (exit 0)
- [ ] `pnpm --filter @theokit/sdk exec biome check src/internal/llm/openai.ts` reports 0 diagnostics
- [ ] `git diff --stat src/internal/llm/openai.ts` shows ≤ 30 net added lines (FSM lives in hermes-tool-extract.ts)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0

#### DoD
- [ ] The two vitest files exit 0
- [ ] `pnpm --filter @theokit/sdk test` exits 0 (full suite — no streaming test regressed)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 AND biome 0 diagnostics
- [ ] `grep -c "R7\|stream-boundary\|suppress" CHANGELOG.md` returns ≥ 1 under `[Unreleased]`

---

## Coverage Matrix

| # | Gap / Requirement (blueprint rec) | Task(s) | Resolution |
|---|---|---|---|
| 1 | rec #1/#2 — stateful hold/flush over the buffer using R5 Set + prefix probe | T1.1 + T2.1 | pure FSM + accumulator glue |
| 2 | rec #3 — finish() (R5) sole promotion path | T2.1 (ADR D1) | finish() unchanged; terminal flush only emits residual text |
| 3 | rec #4 — small cap, fail-open flush | T1.1 (cap) + T2.1 | over-cap → "impossible" → flush |
| 4 | rec #5 — gate behind extractFromContent | T2.1 | flag-OFF immediate-emit path |
| 5 | rec #6 — tests (split held, prose flush, over-cap, flag-off, terminal==finish) | T1.1 + T2.1 | 8 unit + 6 accumulator/golden tests |

**Coverage: 5/5 gaps covered (100%)**

## Global Definition of Done

- [ ] `pnpm --filter @theokit/sdk test` exits 0 (all suites green)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0
- [ ] `pnpm --filter @theokit/sdk exec biome check` reports 0 diagnostics on changed files
- [ ] `wc -l src/internal/llm/hermes-tool-extract.ts` < 500 AND `git diff --stat src/internal/llm/openai.ts` ≤ 30 net added lines
- [ ] `grep -c "stream-boundary\|R7\|suppress" CHANGELOG.md` returns ≥ 1 under `[Unreleased]`
- [ ] Backward compatibility: flag-OFF streams byte-for-byte as today (proven by `test_accumulator_flag_off_streams_immediately`); no public API change (`grep -c "streamToolCallBufferState\|heldText" docs.md` returns 0 — internal)
- [ ] `pnpm validate` exits 0 (knip no orphan; depcruise no new cross-layer violation)
- [ ] Plan archived after `/review` READY_TO_MERGE + merge

## Failure scenarios (when I/O external)

The change is pure in-memory gating of already-received stream content; it adds NO new external I/O. `openai.ts` is an HTTP client, but R7 runs over content already streamed. The relevant behavioral scenario (exercised as a golden test, not a chaos test):

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| OpenAI-compat SSE stream (existing) | a `<function=` marker for a real tool that NEVER closes (truncated stream) | golden: stream `<function=shell_exec><parameter=command>echo` then `done` with no closing `</tool_call>` | fail-open: the held buffer is flushed as visible `text_delta` at the terminal (never held forever, no hang); finish recovers 0 (incomplete block) — same as today's fail-open |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate suppression end-to-end + no streaming regression.

### Execution
```
pnpm --filter @theokit/sdk exec vitest run tests/internal/llm/hermes-tool-extract.test.ts tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts
pnpm --filter @theokit/sdk test        # full suite — catch any streaming/onDelta test regression
pnpm --filter @theokit/sdk typecheck
pnpm --filter @theokit/sdk exec biome check
pnpm validate                          # Tier-1 + knip + depcruise + publint + attw + bundle
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk test` exits 0 (unit + golden + full suites green)
- [ ] `pnpm --filter @theokit/sdk exec vitest run --coverage tests/internal/llm/hermes-tool-extract.test.ts` reports ≥ 90% on `streamToolCallBufferState` (hold/flush + terminal branches 100%)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 AND `pnpm --filter @theokit/sdk exec biome check` reports 0 diagnostics
- [ ] `pnpm validate` exits 0 (knip finds no orphan; depcruise reports 0 new violation)
- [ ] The never-closing-marker fail-open case passes via `test` (a golden test streaming `<function=shell_exec><parameter=command>echo` then `done` with no `</tool_call>` → the buffer flushes as visible `text_delta`)
- [ ] `test_accumulator_terminal_residual_flush_equals_finish_text` asserts the concatenated `text_delta` texts equal `finish.text` (held-then-recovered → "" tail; held-then-flushed → residual)

### If Validation Fails
1. Identify plan-caused vs pre-existing (a streaming test asserting the raw dialect appears in deltas is plan-caused → update to expect suppression).
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Pre-existing issues logged, not blocking.
