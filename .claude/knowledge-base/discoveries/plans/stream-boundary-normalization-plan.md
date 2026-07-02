# Discovery Plan: Stream-Boundary Leaked-Dialect Normalization FSM

> **Version 1.1** (2026-07-01 — absorbed 1 MUST-FIX + 1 SHOULD-TEST from `stream-boundary-normalization-edge-cases-2026-07-01.md`: Q4 repointed at the XMLISH stream test `provider-stream-shared.test.ts:2101` (the v1.0 `:411` citation was the Harmony dialect); Q1 must extract the decision from the pure `getPlainTextToolCallBufferState`, not the tangled main loop) — Investigate openclaw's `@openclaw/tool-call-repair` stream-normalizer FSM (the 3-state `"possible" | "impossible" | "over-cap"` buffer machine that SUPPRESSES suspected tool-call text mid-stream and PROMOTES it to a tool-call event at the boundary, so the raw `<function=…>` dialect never reaches the user as visible deltas) so we can lock the R7 design: turn our `OpenAIStreamAccumulator.applyContentDelta` (which today emits every `text_delta` immediately, `openai.ts:273-277`) into a stateful FSM for OUR `<function=NAME>` xmlish dialect only, reusing R5's request-scoped allowlist as the matcher, gated by the existing `extractToolCallsFromContent` flag, and reconciling with the existing `finish()` tail recovery. In scope: openclaw (primary). Output: a blueprint that locks the R7 FSM design, its buffer discipline, its finish()-interaction, and its test shape.

**Slug:** `stream-boundary-normalization`
**Owner:** paulo
**Created:** 2026-07-01
**Time budget:** 3h (openclaw only — ADR D1)

## Context

R7 = recommendation #7 / technique T1 of the shipped `.claude/knowledge-base/discoveries/blueprints/tool-calling-robustness-blueprint.md` — the "eventual architectural fix", explicitly gated on R5 (request-scoped matching, shipped `@theokit/sdk@2.15.1`) + R6 (doom-loop, shipped `@theokit/sdk@2.15.0`) landing first, both now done. Today our leaked-dialect recovery is POST-stream only: `OpenAIStreamAccumulator.applyContentDelta` (`packages/sdk/src/internal/llm/openai.ts:273-277`) accumulates `this.text += content` AND emits a `text_delta` event immediately; the loop (`packages/sdk/src/internal/agent-loop/loop-llm-stream.ts:199`) forwards it to the user as an `InteractionUpdate`; only later does `finish()` (`openai.ts:308`) recover the leaked call and strip it from the FINAL text. So a user watching the stream sees the raw `<function=…>` dialect flash by before it is recovered. openclaw solves this with a stream-boundary FSM (`.claude/knowledge-base/references/openclaw/packages/tool-call-repair/src/stream-normalizer.ts`, 1370 LoC) that holds suspected tool-call text back until it is confirmed to be (promote) or not to be (flush) a tool call. This discovery locks HOW, at OUR focused scope (only the `<function=` dialect), before we plan the hot-path change. Respects `rules/architecture.md` (the FSM stays inside the OpenAI adapter, request-blind matcher injected) and `rules/parsimony-ladder.md` (borrow the proven technique; do NOT port all 1370 LoC / 3 dialects — only ours).

## Objective

Lock the R7 FSM design: the suppress-vs-flush decision, the "could still be a `<function=`" predicate for our dialect, buffer caps + over-cap behavior, promotion to a tool-call, the finish()-tail reconciliation, and the test shape — grounded in openclaw's implementation.

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for every in-scope reference project
- [ ] Recommendations section provides at least one concrete decision proposal per in-scope research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/openclaw/` | `packages/tool-call-repair/src/stream-normalizer.ts` (the FSM: state machine, xmlish matcher, buffer caps, promotion seam), `src/plugin-sdk/provider-stream.test.ts` + `provider-stream-shared.test.ts` (stream tests) | The ONLY reference with stream-boundary leaked-dialect normalization; its FSM is the exact technique R7 borrows |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| openclaw Harmony (`couldStillBeHarmonyStandaloneToolCall` `:188`) + bracketed (`couldStillBeBracketedStandaloneToolCall` `:75`) dialect paths | Not OUR dialects — we only emit/leak the xmlish `<function=NAME>` form (`hermes-tool-extract.ts:39`). Porting all 3 dialects violates parsimony |
| openclaw `payload.ts` allowlist gate | Already borrowed + shipped in R5 (`@theokit/sdk@2.15.1`); R7 REUSES the R5 `allowedToolNames` Set as the matcher, does not re-discover it |
| `.claude/knowledge-base/references/{agentfw,opencode,cline}/` | Value-coercion (R5-shipped) / loop-guard (R6-shipped) — none does stream-boundary normalization |
| Any project NOT cloned into `.claude/knowledge-base/references/` | Cross-Project Rule: never claim a project feature without reading its source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** openclaw: 3h (single project; the FSM is 1370 LoC and R7 is the largest R, so it gets the deepest single-project dive).

**Rationale:** openclaw is the sole source of the stream-boundary FSM (blueprint cross-cutting table `:112` — only openclaw has it). No second reference has the technique, so budget concentrates on reading the FSM + its tests carefully.

**Alternatives considered:** split across projects (rejected — no other project has stream normalization); shorter budget (rejected — 1370 LoC FSM + hot-path risk needs a careful read).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants, mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue. Do NOT pad with unrelated hotspots.

**Stop condition — per project (mandatory):** When openclaw's 3h budget is exhausted with questions pending, mark them BLOCKED with reason "budget exhausted"; since openclaw is the only project, emit `<promise>BLUEPRINT_BLOCKED</promise>` (NOT `BLUEPRINT_COMPLETE`) with the honest report.

**Anti-pattern:** NEVER fabricate Fase B answers to close a question whose Fase A was exhausted (Unbreakable Rule 3).

**Consequences:** blocked questions surface in `## Blocked questions (if any)`.

### D2 — Investigation depth

**Decision:** Read the FSM's decision core end-to-end (`getPlainTextToolCallBufferState` + `couldStillBeXmlishFunctionToolCall` + the buffer-cap constants + the main normalize loop's suppress/flush); grep-then-read the promotion seam + the tests. SKIP the Harmony/bracketed matcher bodies (out of scope) except where the shared FSM loop references them.

**Rationale:** the FSM is 1370 LoC but only the xmlish path + the shared state machine + buffer discipline are load-bearing for R7; reading the two out-of-scope dialect matchers wastes budget (`rules/parsimony-ladder`).

**Consequences:** the blueprint cites the xmlish + shared-FSM lines, not the Harmony/bracketed bodies.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does the FSM decide to SUPPRESS (buffer, emit nothing) vs FLUSH (emit buffered text) a streaming delta — what are the 3 states, and what transitions each? | techniques | `.claude/knowledge-base/references/openclaw/` | `grep -n "PlainTextToolCallBufferState\|getPlainTextToolCallBufferState\|\"possible\"\|\"impossible\"\|\"over-cap\"" packages/tool-call-repair/src/stream-normalizer.ts` (state type `:50`, computer `:339`) | EC-2: extract the DECISION from the PURE `getPlainTextToolCallBufferState` (`stream-normalizer.ts:339-360`); read the main loop `normalizePlainTextToolCallStreamEvents` (`:1054`+) ONLY to locate WHERE the state gates emission (buffer vs flush) — do NOT fully trace the tangled multi-dialect/over-cap/done-scrub generator | Prose + the 3-state table (state → meaning → transition trigger) + how "impossible" flushes and "possible" holds, with `stream-normalizer.ts:line` per claim |
| Q2 | What is the exact "could this buffered text STILL become a `<function=NAME>` tool call?" predicate for our xmlish dialect, and how does it use the prefix/exact matcher (R5's allowlist)? | techniques | `.claude/knowledge-base/references/openclaw/` | `grep -n "couldStillBeXmlishFunctionToolCall\|hasNamePrefix\|hasExactName\|<function=" packages/tool-call-repair/src/stream-normalizer.ts` (fn `:155`) | Read `stream-normalizer.ts:155-186` (the xmlish predicate) — the marker prefix check, partial-name `hasNamePrefix`, complete-name `hasExactName`, payload-still-building check | Step-by-step of the predicate + how `hasNamePrefix` (partial) vs `hasExactName` (complete) gate it; mapping to our R5 `allowedToolNames` Set + the prefix matcher R7 must add |
| Q3 | What is the buffer discipline — the size caps, the over-cap behavior, and how completed blocks are stripped — so a huge leaked payload neither grows unbounded nor loses its visible suffix? | techniques | `.claude/knowledge-base/references/openclaw/` | `grep -n "BUFFER_MAX_CHARS\|SUPPRESSED_SCAN_MAX\|SUPPRESSED_TAIL\|over-cap\|stripSerializedToolCallPrefixes" packages/tool-call-repair/src/stream-normalizer.ts` (consts `:41-47`, strip `:316`) | Read `stream-normalizer.ts:41-47` (the caps) + `:316-338` (`stripSerializedToolCallPrefixes`, bounded loop) + the over-cap branch in `getPlainTextToolCallBufferState` | The cap values + the over-cap flush semantics + the bounded strip loop, citations; a recommendation on OUR cap (do we need 256k, or smaller?) |
| Q4 | How does openclaw TEST the stream normalizer — the suppress-then-flush of false-positive prose (text that LOOKS like a tool-call prefix but is not), the promote of a real leaked call, and the over-cap case? | tests | `.claude/knowledge-base/references/openclaw/` | EC-1: `grep -n "<function=" src/plugin-sdk/provider-stream-shared.test.ts` (the XMLISH stream test, hotspot `:2101`) — this is OUR dialect; then `grep -n "it(\|suppress\|flush\|promote\|over.cap" src/plugin-sdk/provider-stream*.test.ts` for the false-positive-prose SHAPE (dialect-agnostic; `provider-stream.test.ts:411` is Harmony, cited only for the suppress-flush structure) | Read the xmlish `<function=` stream test block (`:2101`) + one false-positive-prose block: the input delta sequence, the asserted emitted events (text vs promoted tool-call) | Table: test case → input stream → expected emit (held / flushed-as-text / promoted), citations — the exact shape to mirror in vitest for our accumulator |
| Q5 | What is the injection seam + promotion contract — how a completed buffered block becomes provider-native tool-call events, and how the options object wires the matcher + `createPromotedToolCallEvents`? | tools | `.claude/knowledge-base/references/openclaw/` | `grep -n "PlainTextToolCallStreamNormalizerOptions\|createPromotedToolCallEvents\|normalizeDoneMessage\|flushBufferedEvents" packages/tool-call-repair/src/stream-normalizer.ts` (seam `:27-40`) | Read `stream-normalizer.ts:27-40` (the options seam) + `:1069`+ (`flushBufferedEvents` / how promoted events are emitted) | The seam (options object) + the promote-to-events contract, citations; mapping to OUR `consume() → LlmEvent[]` (where a promoted block becomes a held-back text_delta suppression + a tool_use surfaced at finish, or a mid-stream tool event) |
| Q6 | Does the FSM carry any runtime dependency, and how does the stream FSM reconcile with a POST-stream tail recovery (content still buffered when the stream ends)? | deps | `.claude/knowledge-base/references/openclaw/` | `grep -n "import \|new Set\|normalizeDoneMessage\|done\|final\|tail\|end" packages/tool-call-repair/src/stream-normalizer.ts` + Read `packages/tool-call-repair/package.json` deps | Read the imports + the done-message normalization (`normalizeDoneMessage` seam, the tail path) + `package.json` dependencies | "Zero runtime deps (plain string FSM)" + the done/tail reconciliation, citations; a recommendation on how OUR `finish()` (R5 recovery) reconciles with the stream FSM (FSM handles mid-stream, finish() handles the tail) |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q6 | Covered |
| Tools | Q5 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Every `.claude/knowledge-base/references/{project}/{path}` declared in Fase A exists | Mark Qx BLOCKED with reason "path not found", continue |
| Per-question Fase A budget | Fase A returned ≥ 1 hotspot OR 3 query-variant retries attempted | After 3 retries empty, mark Qx BLOCKED "Fase A exhausted"; continue |
| After answering Qx | Blueprint section under Qx has ≥ 1 citation | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | Total citations to `.claude/knowledge-base/references/` ≥ 1 per 200 words of prose | Add citations to under-cited paragraphs (1 retry max) |
| Per-project time budget | openclaw 3h budget not exhausted | When exhausted, mark remaining Qx BLOCKED "budget exhausted"; emit BLUEPRINT_BLOCKED |
| Before promising complete | All 4 coverage corners have populated sections | Refuse promise, continue |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/references/{...}` path
- [ ] At least one ADR section in the blueprint synthesizes the R7 FSM decision (suppress/flush states, xmlish predicate, buffer caps, finish()-tail reconciliation, promotion mapping to our `consume()`)
- [ ] Time budget respected
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/stream-boundary-normalization-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one principle from project rules (`architecture.md` adapter boundary, `parsimony-ladder.md` don't-port-all-3-dialects, `testing.md`)
