# Review — request-scoped-matching (R5)

Date: 2026-07-01 · Cycle: REVIEW (cycle-review.md) · Branch: `develop`
Subject diff: `bec2077^..a508e89` (packages/) — T1.1 `bec2077`, T2.1 `a508e89`, + review-round fixes.
Reviewers: 4 independent specialist agents (architecture, correctness, test-quality, wiring+cross-validation).

**Verdict:** READY_TO_MERGE

## Severity matrix (post-fix)

| # | Severity (as filed) | Finding | Disposition |
|---|---|---|---|
| F1 | **MEDIUM** (test-quality) | Exact-match boundary untested — a substring/superstring leaked name (`read` vs declared `read_file`). A refactor to prefix/`includes` matching would pass every test and silently re-open the false-positive hole. | **FIXED** — `test_gate_is_exact_not_substring_or_superstring` (both directions). |
| F2 | **MEDIUM** (test-quality) | Case-sensitivity untested — a change to case-insensitive matching would pass the suite. | **FIXED** — `test_gate_case_mismatch_leaked_name_is_not_recovered` (declared `Write`, leaked `write` → not recovered). |
| F3 | **MEDIUM** (wiring) | Observability pillar (c) weak on the DROP path — a gated-out leaked block emitted no log/metric; the guard firing was invisible to ops (indistinguishable from "no leak"). | **FIXED** — `HermesExtractResult.droppedNames` + a stderr line in `openai.ts` finish() naming the dropped tool names + provider; `test_gate_reports_dropped_names_for_observability`. |
| F4 | **LOW** (architecture) | The documented public flag `extractToolCallsFromContent` changed observable behavior (leaked blocks for undeclared tools now stay text), but docs.md was not updated — CLAUDE.md requires public-surface behavior in docs.md. | **FIXED** — docs.md:2967 now states recovery promotes a leaked call "only when its name matches a tool declared in the request". |
| F5 | **LOW** (test-quality) | EC-5 residual test proved only "gated-out block kept", not "promoted block stripped". | **FIXED** — added `expect(r.residualText).not.toContain("<function=write")`. |
| F6 | **LOW** (test-quality) | Empty-tools golden test omitted the `stopReason` assertion (parity with its sibling). | **FIXED** — added `expect(finish.stopReason).toBe("end_turn")`. |
| — | LOW/INFO (accepted) | Plan DoD oracle `grep "doomLoop\|allowedToolNames" docs.md` returns 1 (pre-existing unrelated `doomLoop` term collision) — the substantive no-public-API claim holds; noted for future oracle hygiene. Minor line-number/LoC drift in the impl summary (112 vs "110") — no fabrication. The optional-param `undefined→recover-all` default (architecture INFO) is contained: the sole production caller always passes a Set. | No blocker; documented. |

## Confirmed-correct (independent verification)

- **EC-5** (residual strips ONLY promoted blocks; gated-out text preserved) — CONFIRMED by the correctness agent with a concrete input trace + the structural invariant: `isPromoted` is a single closure referenced by both the recovery loop and the residual `.replace` callback over the same captured `allowedToolNames` and the same capture group, so promotion and stripping cannot diverge.
- **Gate semantics** — `undefined` → recover-all (back-compat), empty Set → recover nothing, non-empty → exact case-sensitive membership. Empty-name `<function=>` never matches the `[^>\s]+` capture.
- **Native tool_calls unaffected** — recovery is gated by `extractFromContent && toolCalls.length === 0`; native calls short-circuit before the gate (golden `native tool_calls win` test).
- **Wiring triad** — (a) caller `OpenAIClient.stream(request) → new Set(request.tools.map(name)) → accumulator → finish() → extractHermesToolCalls(text, makeId, allowlist)` traced end-to-end; sole production caller, no ungated recovery path; (b) golden + accumulator integration tests; (c) recover-path AND drop-path both logged (F3 fix).
- **Plan fidelity** — every task T1.1/T2.1, ADR D1/D2/D3, and EC-1/EC-2/EC-5 maps to committed code + tests; no scope creep; no unimplemented plan item.
- **REQUEST-update regression check** — the golden `REQUEST.tools` addition is CORRECT (declared tools == recovered tools), not a fixture-fudge; the 2 new negative golden tests (using requests WITHOUT the leaked tool) are the guard that proves it.
- **Gates** — knip clean (no orphan), depcruise clean (no new cross-layer import), typecheck + biome clean, `pnpm validate` green.

## Hard gates (cycle-review.md)

- No failing tests on the branch · No secrets committed · On `develop` (no direct `main`) · No Co-Authored-By trailer · CHANGELOG updated. All PASS.

## Outcome

No BLOCKER and no HIGH. The 3 MEDIUM (exact-match test, case-sensitive test, drop-path observability) and 3 LOW findings are all FIXED; remaining items accepted with rationale. **READY_TO_MERGE.**
