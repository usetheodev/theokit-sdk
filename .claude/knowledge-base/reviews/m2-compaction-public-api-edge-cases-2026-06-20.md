# Edge Case Review — m2-compaction-public-api (PLAN cycle)

Date: 2026-06-20
Plan analyzed: knowledge-base/plans/m2-compaction-public-api-plan.md
Tasks analyzed: 3 (T1.1 helpers, T1.2 compactTranscript, T2.1 subpath wiring)
Edge cases found: 5 (MUST FIX: 0, SHOULD TEST: 3, DOCUMENT: 2)

> Supersedes the discover-cycle edge-case review of the same slug (which flagged EC-1 shape-mapping + EC-2 no-duplicate-summarizer — both already absorbed: the plan adopts `CompressibleMessage` and reuses `selectCompressionWindow`). This is the plan-scoped review consumed by `/plan-confidence`.

## Boundary map

The helpers are pure in-memory transforms over `CompressibleMessage[]` + `TheokitAgentError`. The ONLY I/O boundary is the optional `summarize` callback in `compactTranscript` (caller-supplied; may throw). No disk/network/concurrency. Live edge families: empty/degenerate input, marker collision/position, and callback failure.

## MUST FIX

(none — every break path is covered by design: `selectCompressionWindow` handles short arrays; `isContextOverflowError` guards `instanceof` before field access; the summarize callback's throw is an intentional propagation, documented. The discovery EC-1/EC-2 are already absorbed into ADRs D1.)

## SHOULD TEST

### EC-1: empty transcript / only-system transcript
- **Affected task:** T1.2
- **Family:** Input
- **Scenario:** `compactTranscript([])` or a transcript with only system messages (nonSystem empty → toCompress empty).
- **Suggested test:** `test_compactTranscript_empty_returns_empty` (`[]` → `[]`) + `test_compactTranscript_only_system_unchanged` (all-system → returned unchanged, nothing summarized). Locks the `selectCompressionWindow` short-circuit path.

### EC-2: `filterFromLatestCheckpoint` when the marker is the LAST message
- **Affected task:** T1.1
- **Family:** Boundary
- **Scenario:** the latest checkpoint marker is the final element → "messages after it" is empty.
- **Suggested test:** `test_filterFromLatestCheckpoint_marker_last_returns_empty` — `[a, cp]` → `[]`. Confirms the `slice(i+1)` boundary is correct (no off-by-one).

### EC-3: `isContextOverflowError` on a subclass of TheokitAgentError carrying the code
- **Affected task:** T1.1
- **Family:** Format
- **Scenario:** the error is a `RateLimitError`/`NetworkError` subclass (all extend `TheokitAgentError`, errors.ts:189,248) that happens to carry `code/metadata.code === "context_too_long"` (mappers may construct a base `AgentRunError`-style instance).
- **Suggested test:** `test_isContextOverflowError_true_on_subclass` — a `TheokitAgentError` subclass instance with the code → true (the `instanceof TheokitAgentError` check covers subclasses). Pins that the predicate is subclass-correct, not exact-class.

## DOCUMENT

### EC-4: `CHECKPOINT_MARKER` collision with real message content
- **Accepted risk:** a real message whose content begins with the exact `CHECKPOINT_MARKER` sentinel would be mistaken for a checkpoint. Mitigated by choosing an unambiguous sentinel (a guarded token unlikely in natural prose) and documenting that `buildCheckpoint` is the only sanctioned producer. Re-validating every message's provenance is the "validate at every layer" paranoia the philosophy forbids — past the boundary the sentinel is trusted. Already in the plan's Drawbacks (Low). No action.

### EC-5: `compactTranscript` is always async (returns a Promise) even on the no-summarize path
- **Accepted risk:** a caller wanting a synchronous truncation still gets a Promise. Chosen for a uniform signature (summarize is async). Documented in the plan (Drawbacks, Low) + docs.md. No action — uniform-async is the simpler contract than a sync/async union.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 2 | 0 | EC-2, EC-3 | EC-4 |
| T1.2 | 2 | 0 | EC-1 | EC-5 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK

The 3 SHOULD TEST items (empty/only-system, marker-as-last, subclass-overflow) are cheap regression locks; fold them into T1.1/T1.2 TDD (plan bump v1.0 → v1.1). No MUST FIX.
