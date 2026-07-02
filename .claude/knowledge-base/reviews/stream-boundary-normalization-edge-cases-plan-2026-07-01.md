# Edge Case Review — stream-boundary-normalization (implementation plan, R7)

Date: 2026-07-01
Plan: .claude/knowledge-base/plans/stream-boundary-normalization-plan.md
Tasks analyzed: 2 (T1.1 pure FSM, T2.1 accumulator buffering + terminal flush)
Cases found: 5 (EDGE: 3, NEGATIVE: 2 | MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: FSM marker match must be case-CONSISTENT with the case-sensitive `HERMES_BLOCK` regex
- **Affected task:** T1.1
- **Kind:** NEGATIVE (correctness / consistency)
- **Family:** Format
- **Scenario:** the T1.1 pseudo-code detects the marker case-INSENSITIVELY (`t.toLowerCase().startsWith("<function=")`, ported from openclaw `stream-normalizer.ts:160`), but `extractHermesToolCalls`'s `HERMES_BLOCK` regex (`hermes-tool-extract.ts:39`, `/<function=\s*([^>\s]+)…/g`) has NO `/i` flag — it is case-SENSITIVE. So a leaked `<Function=read>` would be HELD by the stream FSM (thinks it's a tool call) but the terminal `extractHermesToolCalls` (and `finish()`) would NOT recover it (case mismatch), producing a held-then-late-flushed block and a divergence between "what the FSM suppresses" and "what finish promotes".
- **Impact:** a case-variant marker is buffered then dumped as text at the terminal instead of streaming normally; worse, the FSM's notion of "this is a tool call" disagrees with the extractor's — the two must never disagree (same class as R5's EC where the gate and the emitted call must use the same name).
- **Suggested fix:** in `streamToolCallBufferState`, drop the `.toLowerCase()` — match `<function=` case-sensitively, identical to `HERMES_BLOCK`. Add a RED test `test_state_impossible_for_wrong_case_marker` (`<Function=read>`, allowed={read} → "impossible", since the extractor is case-sensitive).

## SHOULD TEST

### EC-2: the terminal chunk may carry BOTH content and `finish_reason` in one chunk
- **Affected task:** T2.1
- **Kind:** EDGE (boundary — content + terminal in one chunk)
- **Suggested test:** `test_accumulator_terminal_chunk_with_content_and_finish_reason` — one SSE chunk containing the closing `</tool_call>` content AND `finish_reason:"stop"`. Assert the content is appended to `heldText` (via `applyContentDelta`, which runs before `applyFinishReason` in the choice loop, `openai.ts:241` then `:244`) BEFORE the residual flush, so the complete block is recovered by finish and the residual is correct (not a truncated flush).

### EC-3: existing R5 accumulator tests (flag-on recovers) must stay green under R7 holding
- **Affected task:** T2.1
- **Kind:** EDGE (regression on the R5 accumulator suite)
- **Suggested test:** confirm (or update) `test_accumulator_request_scoped_gate_recovers_declared_tool` (`hermes-tool-extract.test.ts`) still asserts `finish.toolCalls` length 1 when the block is now HELD (not streamed) — `finish()` recovers from `this.text` regardless of holding. If it also (implicitly) relied on emitted text, make the assertion event-agnostic. The full-suite run (Integration Validation) is the backstop.

## DOCUMENT

### EC-4: empty / whitespace-only suspicion buffer
- **Kind:** EDGE
- **Accepted risk:** `applyContentDelta` only calls the FSM AFTER appending non-empty content, so `held` is never empty in production; the FSM's behavior on `""` (returns "possible" since `"<function=".startsWith("")`) is unreachable from the accumulator. Pin it with a trivial assertion if convenient, but it cannot mis-fire.

### EC-5: OpenAI `n>1` (multiple choices per chunk)
- **Kind:** NEGATIVE
- **Accepted risk:** `heldText` is a single per-accumulator buffer; with `n>1` streamed choices it would interleave. The SDK does not request `n>1` for chat/tool flows (single completion), so this is unreachable. Same posture as the pre-existing accumulator (which already merges tool-call deltas assuming a single choice).

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 1 (EC-4) | 1 (EC-1) | 1 (EC-1) | 0 | 1 (EC-4) |
| T2.1 | 2 (EC-2, EC-3) | 1 (EC-5) | 0 | 2 (EC-2, EC-3) | 1 (EC-5) |

**Coverage check:** both tasks touch the streaming-buffer input boundary; EDGE (partial marker, terminal chunk, over-cap) and NEGATIVE (wrong-case marker, incomplete block fail-open, n>1) lenses considered.

**Verdict:** PLAN NEEDS ADJUSTMENT (1 MUST FIX — EC-1 case-consistency; absorb into T1.1 + 2 SHOULD-TEST into the TDD blocks; bump plan to v1.1)
