# Edge Case Review — m1-sdkmessage-readers (PLAN cycle)

Date: 2026-06-20
Plan analyzed: knowledge-base/plans/m1-sdkmessage-readers-plan.md
Tasks analyzed: 2 (T1.1 readers, T2.1 subpath wiring)
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 1)

> Supersedes the discover-cycle edge-case review of the same slug (which flagged EC-1/EC-2 mapping checkpoints — both already absorbed into blueprint ADRs D2/D3). This is the plan-scoped review consumed by `/plan-confidence`.

## Boundary map

The readers are **pure in-memory transforms** over already-materialized `SDKMessage` / `CostBreakdown` values (the SDK boundary already validated them). No I/O, no network, no disk, no concurrency, no state mutation. So the INPUT / STATE / I/O / CONCURRENCY checklist families mostly do not apply — the only live edge family is **content-shape / format** of the discriminated `Array<TextBlock | ToolUseBlock>` and the `amountUsd: number | undefined` honesty contract (both confirmed against `packages/sdk/src/types/messages.ts:58-66` and `usage.ts:55-57`).

## MUST FIX

(none — every break-the-build / data-loss path is already covered: non-assistant → ""/[], `costAmountUsd` never coerces undefined→0, inputs not mutated. The discovery edge cases EC-1/EC-2 were already absorbed into the plan's ADRs D2/D3.)

## SHOULD TEST

### EC-1: empty assistant `content` array
- **Affected task:** T1.1
- **Family:** Boundary
- **Scenario:** an assistant message arrives with `message.content: []` (model produced neither text nor tool_use blocks — valid per the type).
- **Suggested test:** `test_assistantText_empty_content_array_returns_empty_string` + `test_extractToolUses_empty_content_array_returns_empty` — assert `assistantText` → `""` and `extractToolUses` → `[]` for an assistant with `content: []` (the filter already yields this; lock it so a future refactor can't regress).

### EC-2: multiple text blocks — concatenation order preserved
- **Affected task:** T1.1
- **Family:** Format
- **Scenario:** an assistant message has several `TextBlock`s interleaved with `tool_use` blocks; `assistantText` must join the text in source order (no reordering, no separator surprise).
- **Suggested test:** `test_assistantText_joins_multiple_text_blocks_in_order` — assert `[{text:"a"},{tool_use},{text:"b"}]` → `"ab"` (verbatim join, tool_use skipped). Pins the `sdk-mappers.ts:17-23` no-separator behavior.

## DOCUMENT

### EC-3: malformed/untyped block bypassing the type (e.g. block missing `type`)
- **Accepted risk:** the readers consume a TYPED `SDKMessage` whose blocks are validated at the SDK ingestion boundary. Defensively re-validating every block's `type` discriminant inside a pure reader is the "validate at every layer" paranoia the edge-case philosophy forbids — past the boundary the data is trusted. The `.filter(b => b.type === "text"|"tool_use")` already drops any block whose discriminant doesn't match, so an unknown block is silently ignored rather than crashing. No action; documented as a conscious trust-boundary decision (consistent with ADR D2).

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 3 | 0 | 2 | 1 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK

The two SHOULD TEST items are cheap regression locks on already-correct behavior (empty-array + ordered-join). They will be folded into T1.1's TDD list (plan bump v1.0 → v1.1). No MUST FIX.
