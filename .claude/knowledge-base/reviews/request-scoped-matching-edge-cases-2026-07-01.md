# Discover Edge Case Review — request-scoped-matching

Date: 2026-07-01
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/request-scoped-matching-plan.md
Research questions analyzed: 6
Edge cases found: 5 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: Q5 "where the tool-name set comes from" may only find the PARAMETER, not the request→set derivation
- **Affected question:** Q5
- **Family:** Method / Scope
- **Scenario:** Q5's Fase A greps `allowedToolNames|matcher` inside `packages/tool-call-repair/` only. But `allowedToolNames` is an INPUT parameter to `tool-call-repair` — the code that DERIVES it from a request lives in openclaw's provider/plugin layer (a caller), not inside `tool-call-repair`. Reading only `tool-call-repair/` shows the `has(name)` gate but not who builds the Set from the request's tools.
- **Impact:** Q5's blueprint answer degrades to "it's an optional parameter" without the request→Set derivation that is the actual analog for our `request.tools → Set` at `openai.ts:172` — the "Tools" corner (injection seam origin) stays thin.
- **Suggested fix:** Add to Q5 Fase A a caller-search across the in-scope test/plugin dirs: `grep -rn "allowedToolNames" .claude/knowledge-base/references/openclaw/src/plugin-sdk/` to locate who passes the allowlist into the repair entrypoint (the origin), and Read that call site.

## SHOULD TEST

### EC-2: Q1 has TWO gate sites (payload.ts:190 and :334) — reading only one loses the "why two" distinction
- **Affected question:** Q1
- **Suggested halt-loop checkpoint:** Before marking Q1 done, assert the Fase B answer explains BOTH `payload.ts:187-190` and `:331-334` (two functions each with the same `new Set(...) && !has(opening.name) → null` gate) and WHY there are two (e.g., two grammar variants / two parse entrypoints) — not just one gate site.

### EC-3: Q4 opencode test is `bun:test` harness-shape only — must not be over-claimed as covering allowlist gating
- **Affected question:** Q4
- **Suggested halt-loop checkpoint:** When answering Q4, assert whether `opencode/packages/llm/test/tool-stream.test.ts` tests request-scoped/allowlist gating or ONLY generic tool-stream parsing; if the latter, the blueprint MUST state opencode contributes harness SHAPE only (bun:test → vitest mapping), and that the false-positive gate test comes from openclaw Q3 — avoiding an over-claim that opencode validates name-gating.

## DOCUMENT

### EC-4: Clone version of openclaw/opencode not pinned in the plan
- **Accepted risk:** R5 borrows a TECHNIQUE (optional-allowlist Set gate + exact-name match), not a version-sensitive API. The reference clones are static snapshots on disk; pinning a date/SHA adds no decision value for a technique-borrow. If a cited line moves, the halt-loop's "path/line exists" checkpoint catches it and re-greps.

### EC-5: Q2's exact-vs-prefix conclusion for OUR finish() is an interpretation, not a line lookup
- **Accepted risk:** Q2 asks the executor to CONCLUDE that exact-name matching suffices for our non-streaming `finish()` (prefix is a streaming-partial concern). This is a reasoned judgment over openclaw's streaming vs payload paths, which the plan's expected-answer-shape explicitly requests ("conclusion on what OUR finish() needs"). Interpretation is inherent and bounded; the two openclaw paths (payload=exact-only, stream=prefix+exact) give a deterministic contrast to reason from.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 0 | 1 | 0 |
| Q2 | 1 | 0 | 0 | 1 |
| Q3 | 0 | 0 | 0 | 0 |
| Q4 | 1 | 0 | 1 | 0 |
| Q5 | 1 | 1 | 0 | 0 |
| Q6 | 0 | 0 | 0 | 0 |
| (cross) EC-4 | 1 | 0 | 0 | 1 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (1 MUST FIX — absorb EC-1 into Q5's method; bump plan to v1.1)
