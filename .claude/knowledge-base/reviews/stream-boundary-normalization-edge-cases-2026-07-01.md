# Discover Edge Case Review — stream-boundary-normalization

Date: 2026-07-01
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/stream-boundary-normalization-plan.md
Research questions analyzed: 6
Edge cases found: 5 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 3)

## MUST FIX

### EC-1: Q4's cited stream-test example is the wrong dialect (Harmony, not our xmlish)
- **Affected question:** Q4
- **Family:** Citation / Method
- **Scenario:** Q4's Fase A cites `provider-stream.test.ts:411` ("streams normal prose that starts with a Harmony channel word") as the stream-test hotspot — but that is the HARMONY dialect false-positive case, not our `<function=NAME>` xmlish case. Grepping `<function=` in the stream tests shows the xmlish stream test actually lives in `src/plugin-sdk/provider-stream-shared.test.ts:2101` (`"<function=read>"`), NOT the cited file/line.
- **Impact:** the executor reads a Harmony test and reports the Harmony suppress-flush shape instead of the xmlish shape R7 needs; the blueprint's "test shape to mirror in vitest" answer targets the wrong dialect.
- **Suggested fix:** change Q4 Fase A to `grep -n "<function=" src/plugin-sdk/provider-stream-shared.test.ts` (hotspot `:2101`) and Read that block; keep `:411` only as the dialect-agnostic false-positive-prose SHAPE reference.

## SHOULD TEST

### EC-2: Q1's main-loop read risks getting lost in a tangled multi-concern async generator
- **Affected question:** Q1
- **Suggested halt-loop checkpoint:** Before marking Q1 done, assert the suppress-vs-flush DECISION was extracted from the PURE `getPlainTextToolCallBufferState` (`stream-normalizer.ts:339-360`). The main loop `normalizePlainTextToolCallStreamEvents` (`:1054`+) is a 300-line async generator mixing `bufferedEvents` / `suppressingOverCapTextToolCall` / `reclassifiedMixedTextContentIndex` / done-scrub across all 3 dialects — read it ONLY to locate WHERE the state gates emission (buffer vs flush), do NOT attempt to fully trace the tangle (`rules/parsimony-ladder`; D2 already scopes this — this checkpoint enforces it).

## DOCUMENT

### EC-3: Q5's promote→our-`consume()` mapping is a design synthesis, not a lookup
- **Accepted risk:** openclaw promotes MID-STREAM to provider-native events via `createPromotedToolCallEvents`; OUR model (`consume() → LlmEvent[]`, `finish() → LlmFinish`) may instead SUPPRESS the text_delta during streaming and surface the recovered `tool_use` at `finish()` (simpler, reuses R5). The blueprint SYNTHESIZES this mapping as an ADR — it is inherent interpretation the plan already flags in Q5's expected-answer shape, bounded by openclaw's concrete seam.

### EC-4: Clone version of openclaw not pinned
- **Accepted risk:** R7 borrows the FSM TECHNIQUE (states + xmlish predicate + buffer discipline), not a version-sensitive API. The clone is a static snapshot; the halt-loop "path/line exists" checkpoint catches any drift and re-greps. Same accepted posture as R5/R6.

### EC-5: Q6's finish()-tail reconciliation is a design decision the blueprint synthesizes
- **Accepted risk:** how the stream FSM (mid-stream) reconciles with our existing `finish()` R5 recovery (tail) is a design conclusion drawn from openclaw's `normalizeDoneMessage` done-seam — interpretation, not a pure lookup, and explicitly requested in Q6's expected-answer shape. The two concrete openclaw anchors (the stream loop + the done seam) give a deterministic contrast to reason from.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 0 | 1 | 0 |
| Q2 | 0 | 0 | 0 | 0 |
| Q3 | 0 | 0 | 0 | 0 |
| Q4 | 1 | 1 | 0 | 0 |
| Q5 | 1 | 0 | 0 | 1 |
| Q6 | 1 | 0 | 0 | 1 |
| (cross) EC-4 | 1 | 0 | 0 | 1 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (1 MUST FIX — repoint Q4 at the xmlish stream test `provider-stream-shared.test.ts:2101`; bump plan to v1.1)
