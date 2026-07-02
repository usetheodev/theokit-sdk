# Discover Edge Case Review — m0-harness-security-floor

Date: 2026-07-02
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/m0-harness-security-floor-plan.md
Research questions analyzed: 6
Edge cases found: 5 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: Q4 (veto) can only be *fully* answered by also reading OUR dispatch
- **Affected question:** Q4 (#68)
- **Family:** Interpretation / Dependency
- **Scenario:** Q4 as written reads only adk-js `plugin_manager.ts:276` to learn the veto *pattern*.
  But #68's actual defect is whether **our** `pre_tool_call` dispatch honors a `{block:true}`
  return. Reading only the peer leaves the defect locus in our own code unconfirmed — the blueprint
  would prescribe a fix approach without pinning WHERE in our SDK the block must be enforced.
- **Impact:** `/to-plan M0` would lack the exact enforcement site, risking a fix that adds a guard
  in the wrong layer (or discovers at implement-time that the block IS already honored and the real
  defect is the CloudAgent early-return at `permission-plugin.ts:116`).
- **Suggested fix:** Extend Q4 Fase B to also Read our own
  `packages/sdk/src/internal/agent-loop/tool-dispatch.ts` + the plugin manager `pre_tool_call`
  path (our src is NOT in the read-only `reference/` zone) to pin the enforcement site. (Absorbed
  into plan v1.1.)

## SHOULD TEST

### EC-2: codex is Rust — port the POLICY MODEL, not the code
- **Affected question:** Q3, Q5 (#54)
- **Suggested halt-loop checkpoint:** Before marking Q3 done, assert the answer captures the
  *abstract* env policy (inherit-mode enum + default-exclude list of secret-like keys), NOT a
  line-by-line Rust transcription. Our fix is TS `execFile`/`spawn` env allowlisting; the value is
  the model (which vars to keep/drop), not Rust syntax.

### EC-3: verify Node stdlib timeout before recommending any dep (#59/#54)
- **Affected question:** Q6
- **Suggested halt-loop checkpoint:** Q6 MUST confirm `AbortSignal.timeout()` exists on Node
  ≥22.12 (our pinned floor) and prefer it; only if a peer shows a genuinely-needed capability
  stdlib lacks may a dep be proposed (parsimony ladder rungs 2-4). Record the stdlib decision
  explicitly so implement-time does not add `p-timeout`/`execa` reflexively.

## DOCUMENT

### EC-4: cross-language peers (crewAI Python, codex Rust, adk TS) — capture model, not syntax
- **Accepted risk:** Q1/Q3 read Python/Rust. The blueprint captures the *design model* (scope-key
  composition; env inherit policy) which transfers to TS. This is inherent to cross-language study
  and already implied by D2; no plan change needed beyond EC-2's checkpoint.

### EC-5: Q2 (adk scoped-state) is #56 *context* / M3 — keep it bounded
- **Accepted risk:** Q2 touches app:/user:/temp: prefixes which are primarily M3 (#62) work. It is
  in-scope here ONLY for the tenant-key aspect that informs #56. The plan already labels it
  "#56 context"; the halt-loop stop conditions prevent it from ballooning into full M3 research.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 0 | 0 | 1 (EC-4) |
| Q2 | 1 | 0 | 0 | 1 (EC-5) |
| Q3 | 1 | 0 | 1 (EC-2) | 0 |
| Q4 | 1 | 1 (EC-1) | 0 | 0 |
| Q5 | 0 | 0 | 0 | 0 |
| Q6 | 1 | 0 | 1 (EC-3) | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (1 MUST FIX — EC-1 absorbed into plan v1.1; 2 SHOULD-TEST checkpoints added)
