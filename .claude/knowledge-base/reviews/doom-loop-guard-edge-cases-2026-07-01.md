# Discover Edge Case Review — doom-loop-guard

Date: 2026-07-01
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/doom-loop-guard-plan.md
Research questions analyzed: 6
Edge cases found: 3 (MUST FIX: 3, SHOULD TEST: 0, DOCUMENT: 0)

## MUST FIX

### EC-1: Q4 target file is ~2400 lines — a naive full Read wastes budget / risks truncation
- **Affected question:** Q4
- **Family:** Method
- **Scenario:** `session-runtime-orchestrator.test.ts` is a large integration suite; the loop-detection/mistake scenarios sit at ~`:1923`, `:2080`, `:2140`. A "Read the file" step pulls thousands of irrelevant lines.
- **Impact:** budget blown / relevant scenario buried; blueprint may under-cite the exact test.
- **Suggested fix:** Q4 Fase B reads ONLY the scenario blocks via offset (`Read` around `:1920-:2170`), driven by the Fase-A grep line numbers — never the whole file.

### EC-2: Q1 target file (opencode `processor.ts`) is large — read only the doom-loop region
- **Affected question:** Q1
- **Family:** Method
- **Scenario:** `processor.ts` is ~1000 lines; the doom-loop logic is a compact region (`:35` const, `:519-545` check, `:966` knob). A full read is wasteful.
- **Impact:** budget/context blown on unrelated session-processing code.
- **Suggested fix:** Q1 Fase B reads ONLY the doom-loop region (the grep'd line windows `:30-40`, `:515-545`, `:960-970`), not the whole file.

### EC-3: opencode's ACTION is a permission-ask (opencode-specific) — do NOT borrow the permission model
- **Affected question:** Q1
- **Family:** Interpretation
- **Scenario:** opencode's doom-loop resolves to `permission: "doom_loop"` — an ask routed through opencode's permission subsystem, which OUR SDK does not have. The blueprint could wrongly recommend a permission model.
- **Impact:** a design-conflation error — recommending opencode's permission gate instead of OUR typed terminal/reason (ADR D3).
- **Suggested fix:** Q1 gains a one-line scope note: "the borrowed value is the FINGERPRINT + WINDOW + THRESHOLD + break-decision TECHNIQUE — NOT opencode's permission model. OUR action is a typed terminal/reason plugged into the existing iteration-tracker seam (cline's `MistakeOutcome` stop/continue is the closer action analog, Q3)."

## SHOULD TEST

_(none — the small-module read-full fallback checkpoint is already in the plan; the large-file read-scoping is handled by the MUST-FIX method refinements above.)_

## DOCUMENT

_(none)_

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 2 | 2 | 0 | 0 |
| Q2 | 0 | 0 | 0 | 0 |
| Q3 | 0 | 0 | 0 | 0 |
| Q4 | 1 | 1 | 0 | 0 |
| Q5 | 0 | 0 | 0 | 0 |
| Q6 | 0 | 0 | 0 | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (3 MUST FIX absorbed into v1.1)
