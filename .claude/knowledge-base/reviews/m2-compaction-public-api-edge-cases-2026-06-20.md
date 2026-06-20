# Discover Edge Case Review — m2-compaction-public-api

Date: 2026-06-20
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/m2-compaction-public-api-plan.md
Research questions analyzed: 7
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

All cited `.claude/knowledge-base/reference/` paths (adk-js context/, crewAI utilities+state+exceptions, codex codex-rs/, opencode ui/) were verified to exist by the baseline exploration before this review.

## MUST FIX

(none — paths resolve, all 4 corners have ≥ 1 question, 7 questions ≤ 15 budget, no corner empty. The greenfield checkpoint design (Q6) and the cross-language transfer are interpretation risks handled below as SHOULD-TEST/DOCUMENT, not blockers.)

## SHOULD TEST

### EC-1: adk-js compacts `Event[]` and crewAI compacts provider message dicts — NEITHER is the SDK's `SDKMessage` / `CompressibleMessage` shape
- **Affected question:** Q5, Q6
- **Suggested halt-loop checkpoint:** when reading adk-js `compact()` / `truncating_context_compactor.ts` and crewAI `summarize_messages`, capture that they operate on adk `Event` objects (with `isCompactedEvent`/`compactedContent` fields) and crewAI message dicts respectively — a DIFFERENT shape from the SDK's `SDKMessage` union and the internal `CompressibleMessage` that `compressConversationWindow`/`selectCompressionWindow` already use. The blueprint MUST map the borrowed algorithm/marker onto the SDK's OWN types (reuse the existing internal `CompressibleMessage` + `SDKMessage`), NOT assume the reference's event/dict shape transfers. Record the shape divergence as a blueprint ADR (mirrors the M1-5 EC-1 SDK-discriminated-blocks decision).

### EC-2: `compactTranscript` must reconcile with the EXISTING internal `compression-*` algorithm — risk of designing a parallel/duplicate algorithm
- **Affected question:** Q4, Q5
- **Suggested halt-loop checkpoint:** before proposing `compactTranscript({messages,keepTokens,summarize})`, the blueprint MUST state whether it (a) wraps/delegates to the existing `compressConversationWindow` + `selectCompressionWindow` (`packages/sdk/src/internal/runtime/compression/`) or (b) is a new pure window-trim that the LLM-summarize path is separate from. Proposal to verify against adk-js's interface+strategy split (Q4): a pure `compactTranscript` that does token-budget keep-recent by default and accepts an optional `summarize` callback to delegate to the existing LLM path — avoids duplicating the internal summarizer (DRY / Rule 9). Decide explicitly; do not ship a second summarizer.

## DOCUMENT

### EC-3: opencode is display-only and codex is Rust — both are weaker sources for the checkpoint design
- **Accepted risk:** Q6's checkpoint-marker synthesis leans most on adk-js (`isCompactedEvent`/`compactedContent`, a real runtime field) and crewAI (`CheckpointConfig`). opencode contributes only a UI marker-rendering shape (`CompactionPartDisplay`) and codex only a string-sentinel concept (`<token_budget>` "Current context window N") in Rust tests — conceptual transfer, not code. D3 already mandates ≥ 2 references for the checkpoint proposal, and the two strong ones (adk-js + crewAI) satisfy it. Documented; the Q6 design gate enforces the 2-reference floor.

### EC-4: `reference/` (singular) vs the golden-rule checker's `references/` (plural)
- **Accepted risk:** the SDK reference tree is `.claude/knowledge-base/reference/` (singular) while `discover-plan-golden-rule.md` keys citation detection on `references/` (plural). All cited paths are REAL and verified; the mismatch means the checker treats them as prose (no fabrication flag fires) — a pre-existing repo divergence under which prior SDK discovery plans (M1-3/M1-4/M1-5) passed. Accepted (identical to the M1-5 EC-4 finding).

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 0 | 0 | 0 | 0 |
| Q2 | 0 | 0 | 0 | 0 |
| Q3 | 0 | 0 | 0 | 0 |
| Q4 | 1 | 0 | (shared EC-2) | 0 |
| Q5 | 2 | 0 | EC-1, EC-2 | 0 |
| Q6 | 2 | 0 | (shared EC-1) | EC-3 |
| Q7 | 0 | 0 | 0 | 0 |
| (plan-wide) | 1 | 0 | 0 | EC-4 |

**Verdict:** DISCOVERY PLAN OK (no MUST FIX; 2 SHOULD-TEST checkpoints — shape mapping + no-duplicate-summarizer — to fold into the execute halt-loop for precision)
