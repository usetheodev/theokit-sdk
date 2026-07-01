# Blueprint: Stream-Boundary Leaked-Dialect Normalization FSM (R7)

> **Version 1.0** — Synthesizes openclaw's `@openclaw/tool-call-repair` stream-normalizer FSM: a 3-state buffer machine (`getPlainTextToolCallBufferState` → `"possible"` HOLD / `"impossible"` FLUSH / `"over-cap"`) that, per streaming delta, buffers text that "could still become a `<function=NAME>` tool call" and emits it as visible text only once it is confirmed NOT to be one — promoting a real leaked block to a tool-call at the stream `done`. Zero runtime deps. The load-bearing conclusion for R7: **for our SDK the change is a STREAMING SUPPRESSION layer only** — hold back `text_delta` events while the buffer could still be a `<function=` tool call (reusing R5's `allowedToolNames` as an exact + new prefix matcher), and let the existing `finish()` recovery (R5) do the actual promotion. We do NOT need openclaw's mid-stream promotion because `finish()` already recovers + strips. In scope: openclaw. Output locks the R7 FSM design + its reconciliation with `finish()`.

**Slug:** `stream-boundary-normalization`
**Source plan:** `.claude/knowledge-base/discoveries/plans/stream-boundary-normalization-plan.md`
**Owner:** paulo
**Generated:** 2026-07-01 via `/discover-execute` (inline — bounded 6-question scope)
**Confidence verdict:** {updated by `/discover-confidence`}

## Context

R7 = recommendation #7 / technique T1 of `tool-calling-robustness-blueprint.md`, gated on R5 (shipped `@theokit/sdk@2.15.1`) + R6 (shipped `@theokit/sdk@2.15.0`). Today `OpenAIStreamAccumulator.applyContentDelta` (`packages/sdk/src/internal/llm/openai.ts:273-277`) emits every `text_delta` immediately, so the raw `<function=…>` dialect streams to the user (via `loop-llm-stream.ts:199`) before `finish()` (`openai.ts:308`) recovers it. R7 holds that text back at the stream boundary.

## Objective

Lock the R7 FSM design: suppress/flush states, the xmlish "could still be" predicate, buffer caps, the finish()-tail reconciliation, and promotion mapping — for our `<function=` dialect only.

---

## Coverage Corner 1 — Integration Tests

### openclaw — split `<function=` markers are buffered, never emitted as text, then converted at `done`

The canonical xmlish stream test is `"keeps split XML function tool-call markers buffered for conversion"` (`.claude/knowledge-base/references/openclaw/src/plugin-sdk/provider-stream-shared.test.ts:2097`):
- pushes `text_delta` `"<"` then the rest of `<function=read><parameter=path>src/index.ts</parameter></function>` split across deltas (`:2113-2121`);
- pushes `done` with the full text in the message (`:2122`);
- asserts the emitted event is `toolcall_start` (`:2131` region) — **NOT** a text delta. The raw `<function=…>` was buffered while "possible" and converted to a tool call at `done`; the user never saw the dialect as visible text.

The dialect-agnostic false-positive-prose SHAPE ("prose that starts with a marker-looking word is flushed as text, not held") is exercised at `.claude/knowledge-base/references/openclaw/src/plugin-sdk/provider-stream.test.ts:411` (Harmony variant) — the same suppress-then-flush structure R7's tests mirror for the xmlish case.

**Shape to mirror in vitest for our accumulator:** feed split `<function=NAME>` deltas → assert NO `text_delta` events emitted for them (held) → assert the recovered `tool_use` at `finish()`. Feed prose that starts with `<functio` but diverges (e.g. `<functional programming>`) → assert it IS flushed as `text_delta` (impossible → flush).

---

## Coverage Corner 2 — Dependencies

### openclaw — zero runtime dependencies

`@openclaw/tool-call-repair` `package.json` `dependencies: {}`. `stream-normalizer.ts` imports ONLY from its sibling `./grammar.js` (`stream-normalizer.ts:2-13`: `findXmlishToolCallEnd`, `isXmlishNameChar`, `matchesLiteralPrefix`, `consumeJsonToolClosingMarker`, …) — pure string-grammar helpers, no external library. **Implication for R7:** the streaming suppression FSM needs NO new dependency (plain string scanning; `rules/parsimony-ladder` Rule 9).

---

## Coverage Corner 3 — Tools

### openclaw — the seam + how promotion is emitted at the stream boundary

The injection seam is `PlainTextToolCallStreamNormalizerOptions` (`stream-normalizer.ts:27-40`): `createPromotedToolCallEvents(message)` (`:29`), `matcher` (the request-scoped name matcher, `:31`), `normalizeDoneMessage(params)` (`:33`). The main loop `normalizePlainTextToolCallStreamEvents` (`:1054`) drives it:
- per `text_delta`: appends to `bufferedText`, computes `getPlainTextToolCallBufferState(scanBufferedText, matcher)` (`:1182`); `"impossible"` → `flushScrubbedBufferedNonTextEvents(true)` + emit the visible text as a scrubbed `text_delta` (`:1183-1196`); `"possible"` → `suppressBufferedTextEvents()` (HOLD, emit nothing, `:1204`); `"over-cap"` → suppress + cap handling (`:1208-1212`).
- at `done`: `normalizeDoneMessage(...)` (`:1218`) — if promotable, `createPromotedToolCallEvents(normalizedMessage.message)` + yield `{...record, reason: "toolUse", message}` (`:1231-1232`).

**Mapping to OUR `consume() → LlmEvent[]`:** our accumulator does NOT need `createPromotedToolCallEvents` (mid-stream promotion). R7 maps the `"possible"`→HOLD / `"impossible"`→FLUSH gate onto `applyContentDelta`: while the suspicion buffer is `"possible"`, `consume()` returns NO `text_delta` for it; when `"impossible"`, it flushes the buffered text as a `text_delta`. Promotion stays at `finish()` (the existing R5 recovery over `this.text`), which is our equivalent of `normalizeDoneMessage`.

---

## Coverage Corner 4 — Techniques

### T-R7a — The 3-state suppress/flush FSM (`getPlainTextToolCallBufferState`)

```ts
// .claude/knowledge-base/references/openclaw/packages/tool-call-repair/src/stream-normalizer.ts:339-360
function getPlainTextToolCallBufferState(text, matcher): "possible" | "impossible" | "over-cap" {
  const trimmed = text.trimStart();
  if (trimmed.length === 0) return text.length > MAX ? "impossible" : "possible";
  const toolCallLike = couldStillBeBracketed(...) || couldStillBeXmlishFunction(trimmed, matcher) || couldStillBeHarmony(...);
  if (!toolCallLike) return "impossible";                 // FLUSH: confirmed not a tool call
  if (text.length <= MAX) return "possible";              // HOLD: could still become one
  // over cap: strip complete blocks; residual visible text → flush, else over-cap
  const rest = stripSerializedToolCallPrefixes(trimmed, matcher);
  return rest !== null && rest.trim() ? "impossible" : "over-cap";
}
```

| State | Meaning | Our action |
|---|---|---|
| `"possible"` | buffer could still become a `<function=…>` tool call (under cap) | HOLD — do not emit `text_delta`; keep buffering |
| `"impossible"` | buffer is confirmed NOT a tool call | FLUSH — emit the buffered text as `text_delta`, reset buffer |
| `"over-cap"` | buffer exceeded the cap while still tool-call-like | flush/cap — avoid unbounded growth |

For R7 we call ONLY `couldStillBeXmlishFunctionToolCall` (drop the bracketed/Harmony disjuncts — not our dialects).

### T-R7b — The xmlish "could still be a `<function=NAME>`" predicate

```ts
// stream-normalizer.ts:155-186
function couldStillBeXmlishFunctionToolCall(text, matcher): boolean {
  if (!matchesLiteralPrefix(text.toLowerCase(), "<function=")) return false;   // not our marker
  if (text.length <= "<function=".length) return true;                          // just the marker so far → keep buffering
  // read the (partial) name; a partial name must still PREFIX-match a real tool
  const name = <name chars after marker>;
  if (!name || !matcher.hasNamePrefix(name)) return false;                      // name can't become a real tool → flush
  if (cursor >= text.length) return true;                                       // name still streaming → hold
  if (text[cursor] !== ">") return false;
  if (!matcher.hasExactName(name)) return false;                                // complete name not a real tool → flush
  return couldStillBeXmlishParameterPayload(text, cursor + 1);                  // payload still building → hold
}
```

**The matcher is R5's allowlist, extended with a prefix probe.** `hasExactName` is exactly R5's `allowedToolNames.has(name)`. `hasNamePrefix(partial)` is NEW for R7: "does any allowed tool name START WITH `partial`?" — needed because during streaming the name arrives partially (`<function=rea` before `read` completes). Our `Set<string>` gains a cheap prefix probe: `[...allowedToolNames].some(n => n.startsWith(partial))`. This is the load-bearing safety property: a leaked marker for a NON-tool name is flushed as text the moment its (partial) name can no longer prefix-match any request tool.

### T-R7c — Buffer discipline (caps + bounded strip)

`TEXT_TOOL_CALL_BUFFER_MAX_CHARS = 256_000` + a `+64_000` scan tail (`stream-normalizer.ts:41-47`) so a huge leaked payload neither grows unbounded nor loses its visible suffix. `stripSerializedToolCallPrefixes` (`:316-338`) is a **bounded 32-iteration** loop stripping complete serialized blocks from the front (never unbounded). **Recommendation for R7:** our `<function=…></tool_call>` blocks are tiny (a tool call, not a document); a far smaller cap (e.g. a few KB) suffices — the cap exists only to bound a pathological non-closing marker. Adopt a small `MAX` + flush on over-cap (treat the buffered text as visible text if it never closes).

---

## Cross-cutting Comparison

| Dimension | openclaw (`stream-normalizer.ts`) | → OUR R7 (focused) |
|---|---|---|
| Dialects handled | xmlish + Harmony + bracketed (`:348-350`) | xmlish `<function=` ONLY |
| Decision fn | `getPlainTextToolCallBufferState` 3-state (`:339`) | same 3-state, xmlish disjunct only |
| Name matcher | `hasNamePrefix` + `hasExactName` (`:14-19`) | R5 `allowedToolNames` Set + a `.some(startsWith)` prefix probe |
| Promotion | mid-stream `createPromotedToolCallEvents` at `done` (`:1231`) | NONE mid-stream — `finish()` (R5 recovery) already promotes |
| Suppress vs flush | HOLD on `"possible"`, emit scrubbed text on `"impossible"` (`:1182-1204`) | gate `applyContentDelta`: hold `text_delta` on `"possible"`, flush on `"impossible"` |
| Buffer cap | 256k + 64k tail (`:41-47`) | small cap (KB-scale) — our blocks are tiny |
| Deps | `{}` (grammar.js only) | zero new deps |

## ADRs

### D1 — R7 is a STREAMING SUPPRESSION layer; `finish()` (R5) keeps doing promotion

**Decision:** R7 makes `OpenAIStreamAccumulator` hold back `text_delta` events for content that could still be a `<function=` tool call (buffer while `"possible"`, flush on `"impossible"`), while `this.text` accumulation and the `finish()` recovery (R5) are UNCHANGED — `finish()` still promotes the recovered tool call and strips it from the final text.

**Rationale:** openclaw promotes mid-stream because it has no post-stream recovery step; WE already have `finish()` recovery (R5). Duplicating promotion mid-stream would create two promotion paths (divergence risk, more hot-path code). Suppression alone achieves the UX goal (raw dialect never flashes by) with the minimum change (`rules/parsimony-ladder`; `rules/architecture.md` — the change stays inside the OpenAI adapter). `this.text` staying whole means `finish()`'s R5 gate + strip work exactly as today.

**Alternatives considered:** (a) full openclaw port with mid-stream promotion events — rejected, a second promotion path + 3-dialect complexity we don't need; (b) do nothing (keep emitting raw dialect) — rejected, that's the UX bug R7 exists to fix.

**Consequences:** `applyContentDelta` becomes stateful (a suspicion buffer); `consume()` sometimes returns no `text_delta` (holding) and later flushes accumulated text. Held-but-not-a-tool-call text is flushed on `"impossible"` before `finish()`; held-and-is-a-tool-call text is never emitted (finish strips it from `this.text`). Gated by `extractFromContent` (off → stream normally, zero behavior change).

### D2 — The matcher is R5's `allowedToolNames` Set + a prefix probe

**Decision:** reuse the R5 request-scoped `Set<string>` (already built in `stream()`); add `hasNamePrefix(partial) = [...set].some(n => n.startsWith(partial))` and `hasExactName = set.has`.

**Rationale:** the streaming predicate needs a partial-name probe (the name arrives token-by-token); a `.some(startsWith)` over the small request tool-set is O(tools × name-len), negligible. Keeps R5 and R7 on ONE source of truth for "is this a real request tool" (DRY). No new data structure or dep.

**Alternatives considered:** a trie for prefix matching — rejected (YAGNI; request tool-sets are tiny, a linear scan is simpler and faster in practice).

**Consequences:** a leaked marker for a non-tool name flushes as visible text the instant its partial name can't prefix any request tool — the false-positive guard extends to streaming.

### D3 — Small buffer cap; flush on over-cap (never hang, never grow unbounded)

**Decision:** cap the suspicion buffer at a small KB-scale limit; on over-cap (a marker that never closes), FLUSH the buffered text as visible `text_delta` (treat it as prose).

**Rationale:** our `<function=…></tool_call>` blocks are small; openclaw's 256k is sized for arbitrary documents. A small cap bounds a pathological non-closing marker (`rules/error-handling.md` — fail-open to visible text, never hang the stream). Mirrors openclaw's over-cap-flush intent (`stream-normalizer.ts:354-360`) at our scale.

**Alternatives considered:** openclaw's 256k — rejected (oversized for a tool call); no cap — rejected (unbounded buffer on a non-closing marker is a hang/OOM risk).

**Consequences:** a legitimately huge non-tool text that happens to start with `<function=` a real tool name and never closes is flushed after the cap (visible) — acceptable, extremely rare, and safe.

## Recommendations for the project

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Make `applyContentDelta` stateful: buffer while `getState(buffer) === "possible"` (xmlish predicate over R5's Set), flush `text_delta` on `"impossible"`/`"over-cap"`; keep `this.text` whole | Q1, Q2, Q5, D1 | HIGH |
| 2 | Add `hasNamePrefix` (`.some(startsWith)`) + reuse `hasExactName` (`Set.has`) on the R5 allowlist | Q2, D2 | HIGH |
| 3 | Keep `finish()` (R5 recovery) as the sole promotion path; R7 only suppresses the stream | Q5, Q6, D1 | HIGH |
| 4 | Small KB-scale buffer cap; flush on over-cap (fail-open to visible text) | Q3, D3 | HIGH |
| 5 | Gate the whole FSM behind `extractFromContent` (off → stream unchanged) | Q1, D1 | HIGH |
| 6 | Tests: split-marker held-not-emitted → recovered at finish; false-positive prose (`<functional…>`) flushed as text; over-cap flush; flag-off streams unchanged | Q4, D1/D3, testing.md §4.1 | HIGH |

## Blocked questions (if any)

None — all 6 research questions answered with verified citations.

## Halt-loop progress (audit trail)

- Execution mode: inline (bounded 6-question scope; `rules/loop-engine-convention.md`)
- Questions answered: 6 / 6 · blocked: 0 · coverage corners populated: 4 / 4
- Citations verified: all `.claude/knowledge-base/references/openclaw/` paths + line ranges read directly

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/stream-boundary-normalization-plan.md`
- Umbrella blueprint: `.claude/knowledge-base/discoveries/blueprints/tool-calling-robustness-blueprint.md` (R7 = rec #7 / T1)
- Prior R's reused: R5 `@theokit/sdk@2.15.1` (allowlist Set + finish() recovery), R6 `@theokit/sdk@2.15.0`
- Project rules: `.claude/rules/architecture.md` (adapter boundary), `.claude/rules/parsimony-ladder.md` (don't port 3 dialects), `.claude/rules/testing.md` (§4.1), `.claude/rules/error-handling.md` (fail-open on over-cap)
