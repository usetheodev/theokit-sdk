# Discover Edge Case Review — m1-harness-correctness

Date: 2026-07-02
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/m1-harness-correctness-plan.md
Research questions analyzed: 5
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 2)

## MUST FIX

### EC-1: Q1/Q2/Q3 must also read OUR own loci to pin the fix sites (not only the peers)
- **Affected question:** Q1 (#58), Q2 (#55), Q3 (#65/#57)
- **Family:** Interpretation / Dependency
- **Scenario:** The peers show the PATTERN, but each M1 fix lands in OUR specific code
  (`tool-dispatch.ts runToolWithLifecycle`, `permission-engine.ts evaluate`, `plugins/manager.ts`
  hook-runners + `types.ts HookName`, `job-queue.ts`). A blueprint that reads only peers leaves the
  exact enforcement site in our code unpinned (the M0 lesson — EC-1 there caught the real #68 locus).
- **Suggested fix:** each of Q1/Q2/Q3 Fase B ALSO reads the matching OUR-code file to pin the fix
  site + the current signature that must change (our src is editable, not the read-only `reference/`
  zone). Absorbed into plan v1.1.

## SHOULD TEST

### EC-2: verify Node stdlib abort/timeout before proposing p-queue/p-timeout (Q5)
- **Affected question:** Q5
- **Suggested checkpoint:** Q5 MUST confirm `AbortController` + `AbortSignal.timeout()` on Node
  ≥22.12 and prefer them; a queue dep is justified only if a genuinely-needed capability stdlib lacks
  (parsimony rungs 2-4). Record the stdlib decision explicitly.

## DOCUMENT

### EC-3: codex execpolicy is Rust — capture the arg-gating MODEL, not the code
- **Accepted risk:** Q2 reads Rust. The blueprint captures the design model (program+args matcher +
  default posture) which transfers to a TS `evaluate(toolName, args?)`. Cross-language, per D2.

### EC-4: #57 injection/PII defense is thin across peers — be honest about external best-practice
- **Accepted risk:** peers have weak content-level injection defense (the cross-val flagged it as a
  gap even in mastra). The blueprint will ground #57 where possible (crewAI guardrail-retry as the
  validation-loop precedent) but MUST honestly note the core technique (delimiting/spotlighting tool
  results + PII regex redaction) is partly external best-practice, wired via the `transform_tool_result`
  seam (#65). Not investigation theatre — an honest partial.

## Summary

| Question | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|----------|-------------|----------|
| Q1 | 1 (EC-1) | 0 | 0 |
| Q2 | (EC-1) | 0 | 1 (EC-3) |
| Q3 | (EC-1) | 0 | 1 (EC-4) |
| Q5 | 0 | 1 (EC-2) | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (1 MUST FIX EC-1 absorbed into Q1-Q3; EC-2 checkpoint added)
