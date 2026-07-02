# Discover Edge Case Review — tool-calling-robustness

Date: 2026-07-01
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/tool-calling-robustness-plan.md
Research questions analyzed: 7
Edge cases found: 5 (MUST FIX: 3, SHOULD TEST: 2, DOCUMENT: 0)

## MUST FIX

### EC-1: `tool-call-repair` is a tiny isolated package — keyword Fase A can false-BLOCK
- **Affected question:** Q1
- **Family:** Method
- **Scenario:** Q1's Fase A greps `stream-normalizer.ts`/`promote.ts` for `possible|impossible|promote|buffer|MAX_|tail`. If OpenClaw named its state machine differently (e.g. `pending`/`candidate`/`flush`), the grep returns empty and D1's per-question stop condition marks Q1 BLOCKED after 3 retries — losing the single most important (P3-core) answer.
- **Impact:** The blueprint loses the stream-boundary state-machine — the architectural core — and caps below SHIPPABLE.
- **Suggested fix:** Q1 method becomes "SKIP Fase A — the package is 5 small files; Read `stream-normalizer.ts` + `promote.ts` + `grammar.ts` + `payload.ts` end-to-end." (An isolated small package is text-shape, not hotspot-shape.)

### EC-2: JSON-repair lives OUTSIDE the `tool-call-repair` package → "dependency-free" is misleading
- **Affected question:** Q6
- **Family:** Reference path / Interpretation
- **Scenario:** `openclaw/packages/tool-call-repair/package.json` declares no `dependencies` at all, so Q6's Fase A scoped to `tool-call-repair/src` finds no repair lib and concludes "dependency-free". But the promoted call's ARG-JSON repair happens in a different OpenClaw package (the 3-tier `parseStreamingJson` using `partial-json`), which the scoped grep never sees.
- **Impact:** The blueprint would wrongly conclude "no JSON-repair dependency needed", steering P1 to hand-roll repair (violates `rules/parsimony-ladder.md` don't-reinvent).
- **Suggested fix:** Broaden Q6 Fase A to `grep -rn "partial-json\|jsonrepair\|repairJson\|parseStreamingJson\|partialParse" openclaw/packages cline/sdk` (all packages), and record the finding as "normalizer package is dep-free; arg-JSON repair uses \<lib\> at \<path\>".

### EC-3: agentfw does NOT parse our attribute-inline `<function=NAME><parameter=KEY>` dialect
- **Affected question:** Q2
- **Family:** Interpretation
- **Scenario:** agentfw's cascade parses `<tool_call>{JSON}` (Hermes-JSON) and `<invoke name=><parameter name=>` (Anthropic-legacy) — NOT the attribute-inline `<function=NAME><parameter=KEY>VALUE</parameter>` we leak (that grammar is OpenClaw's, Q1). If the blueprint conflates them, it may claim agentfw handles our dialect.
- **Impact:** A dialect-conflation error in the blueprint → P1/P2 could cite the wrong grammar source.
- **Suggested fix:** Q2 gains a one-line scope note: "agentfw's borrowed value is the CASCADE + fast-gate + TRIM + `coerceParameter` + tolerant-fallback + always-strip TECHNIQUE, applicable to our grammar — NOT agentfw's specific dialect grammars. Our `<function=>` grammar reference is Q1 (OpenClaw) + our own `hermes-tool-extract.ts`."

## SHOULD TEST

### EC-4: cline/opencode safety modules — read-full fallback before BLOCK
- **Affected question:** Q3
- **Suggested halt-loop checkpoint:** "Before marking Q3 BLOCKED on empty Fase A, Read `loop-detection.ts` + `mistake-tracker.ts` (cline) and the doom-loop region of `processor.ts` (opencode) fully — they are small safety modules; a keyword miss must not BLOCK a readable file."

### EC-5: test-command is not in the test-file header (Q7 tools corner)
- **Affected question:** Q7
- **Suggested halt-loop checkpoint:** "For Q7's test-command answer, Read `opencode/packages/llm/package.json` (scripts) and the repo test-runner config (bunfig/vitest.config) — the runner command is declared there, not in the `.test.ts` header."

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 1 | 0 | 0 |
| Q2 | 1 | 1 | 0 | 0 |
| Q3 | 1 | 0 | 1 | 0 |
| Q4 | 0 | 0 | 0 | 0 |
| Q5 | 0 | 0 | 0 | 0 |
| Q6 | 1 | 1 | 0 | 0 |
| Q7 | 1 | 0 | 1 | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (3 MUST FIX absorbed into v1.1)
