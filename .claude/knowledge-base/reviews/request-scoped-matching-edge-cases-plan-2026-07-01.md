# Edge Case Review — request-scoped-matching (implementation plan)

Date: 2026-07-01
Plan: .claude/knowledge-base/plans/request-scoped-matching-plan.md
Tasks analyzed: 2 (T1.1 pure gate, T2.1 wiring)
Cases found: 5 (EDGE: 2, NEGATIVE: 3 | MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 2)

Boundary verification performed during this review (evidence, not speculation): grepped the full test suite — only TWO sites feed a leaked `<function=` block (`tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts` [integration, T2.1 updates it] and `tests/internal/llm/hermes-tool-extract.test.ts` [2-arg unit calls → recover-all, back-compat, unaffected]). `extractToolCallsFromContent: true` also appears in `tests/internal/llm/router.test.ts`, but that test exercises FLAG ROUTING, not recovery output (no `<function=` block). **No hidden third test site relies on unscoped recovery** — the interaction risk the plan flagged (Drawbacks #1) is fully contained to the one golden file T2.1 already updates.

## MUST FIX

### EC-5: `residualText` strips ALL matched blocks — a gated-out block's text is silently deleted when another block IS recovered
- **Affected task:** T1.1
- **Kind:** NEGATIVE (correctness / data loss)
- **Family:** State / Format
- **Scenario:** `hermes-tool-extract.ts:68` computes `residualText = toolCalls.length === 0 ? content : content.replace(HERMES_BLOCK, "").trim()`. The `content.replace(HERMES_BLOCK, "")` strips EVERY block matching the regex, regardless of whether it was recovered. Pre-R5 this was correct (every matched block was recovered). With the R5 gate, a MATCHED block can be gated OUT (name not in the request tools). If the same content has one recovered block (so `toolCalls.length > 0`) AND one gated-out block (e.g. a code assistant emits a real `<function=shell_exec>` call AND writes `<function=example>` in a fenced code sample), the gated-out `<function=example>` text is STRIPPED from the visible response — silent loss of the model's real text output.
- **Impact:** the plan's own T1.1 pseudo-code promises "leave block text in residual, do not promote", but the unchanged line-68 logic breaks that promise whenever ≥1 block is recovered. Contradicts EC-2's "block stays visible" expectation and the blueprint's false-positive-safety intent.
- **Suggested fix:** in T1.1, change the residual computation to strip ONLY recovered blocks — replace with a callback that re-applies the same gate: `content.replace(HERMES_BLOCK, (full, rawName) => { const nm = (rawName ?? "").trim(); const promoted = nm.length > 0 && (allowedToolNames === undefined || allowedToolNames.has(nm)); return promoted ? "" : full; }).trim()`. Add a RED test: two blocks (write recovered, example gated out) → `residualText` still contains `<function=example`.

## SHOULD TEST

### EC-1: parsed leaked name with incidental whitespace could miss an exact-name gate
- **Affected task:** T1.1 (and its consumption in T2.1)
- **Kind:** NEGATIVE (leaky provider emits a slightly-malformed name)
- **Scenario:** a dialect-leaking provider (the same class that caused the P0 whitespace hang) emits `<function=shell_exec >` or a trailing newline in the name. If the parser's `name` carries whitespace, `allowedToolNames.has("shell_exec ")` is false → a REAL tool is silently dropped.
- **Suggested test:** `test_gate_matches_on_the_same_name_used_for_the_recovered_call` — assert the name string the gate checks is identical to the name placed on the recovered `toolCall.name` (i.e. both are the post-parse/trimmed name). If the parser does not already trim the name, add `.trim()` at the single parse site so the gate and the emitted call agree (≤1 line).

### EC-2: whole-request no-tools on a leaky route silently recovers nothing (behavior change surface)
- **Affected task:** T2.1
- **Kind:** EDGE (smallest valid tool set = empty)
- **Suggested test:** already planned as `test_flag_on_empty_request_tools_recovers_nothing` — KEEP it, and additionally assert the visible `text` still contains the leaked `<function=` (the block is not silently deleted, just not promoted), so a human debugging sees the leak. Assert `finish.text` contains `<function=`.

## DOCUMENT

### EC-3: exact-name matching is case-sensitive — a case-mismatch drops recovery
- **Kind:** EDGE
- **Accepted risk:** resolved in ADR D1 — case-sensitive matches openclaw (`payload.ts:190`) and our tool-name regex `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` is case-significant. A model is expected to echo the exact declared tool name. Low probability for the target leaky providers (qwen3-coder leaks the name verbatim). No fix; note it in the CHANGELOG entry so consumers know the gate is exact/case-sensitive.

### EC-4: empty-name malformed block
- **Kind:** NEGATIVE
- **Accepted risk:** a malformed `<function=>` (empty name) with an allowlist is safely DROPPED (`""` is never a real tool name) — R5 strictly improves this over today (where absent-allowlist recover-all could promote an empty-name block). Pre-existing behavior for the 2-arg path is unchanged. No new fix needed.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 1 (EC-3) | 2 (EC-1, EC-4, EC-5) | 1 (EC-5) | 1 (EC-1) | 2 (EC-3,EC-4) |
| T2.1 | 1 (EC-2) | 0 | 0 | 1 (EC-2) | 0 |

**Coverage check:** both tasks touch the name-matching input boundary; both EDGE (in-set / empty-set / case) and NEGATIVE (out-of-set / whitespace-name / empty-name / residual-strip) lenses considered.

**Verdict:** PLAN NEEDS ADJUSTMENT (1 MUST FIX — EC-5 residual-strip data loss; absorb into T1.1 + 2 SHOULD-TEST assertions into the existing TDD blocks; bump plan to v1.1)
