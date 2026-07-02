# Implementation summary — request-scoped-matching (R5)

Plan: `.claude/knowledge-base/plans/request-scoped-matching-plan.md` (SHIPPABLE 94.8)
Blueprint: `.claude/knowledge-base/discoveries/blueprints/request-scoped-matching-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89.0)
Verdict: **IMPLEMENTATION_COMPLETE** · 2026-07-01 · branch `develop`

## Commits (TDD, atomic)

| Task | Commit | What |
|---|---|---|
| T1.1 | `bec2077` | `extractHermesToolCalls` gains optional `allowedToolNames?: ReadonlySet<string>` exact-name gate + EC-5 residual-strip-only-promoted; 7 unit tests + CHANGELOG + changeset (patch) |
| T2.1 | `a508e89` | `OpenAIStreamAccumulator` optional 3rd ctor arg; `stream()` builds `new Set(request.tools?.map(t=>t.name) ?? [])`; `finish()` threads it; golden REQUEST declares its tools + 2 negative golden tests + 2 accumulator wiring tests |

## Design (per blueprint + plan ADRs)

- **D1** — optional `ReadonlySet<string>` gate: `undefined` → recover-all (back-compat for direct callers), empty set → recover nothing, non-empty → exact case-sensitive `Set.has(name)`. Mirrors openclaw `payload.ts:190`.
- **D2** — the Set is built ONCE in `stream()` from `request.tools` and threaded through the accumulator; empty request tools → empty Set → recover nothing (safe default).
- **D3** — the `extractToolCallsFromContent` route flag stays the coarse enable; the allowlist is the within-route false-positive guard (orthogonal, both cheap).
- **EC-5 (MUST-FIX from edge-case review)** — residual now strips ONLY promoted blocks (a `.replace(HERMES_BLOCK, cb)` re-applying the same gate), so a gated-out `<function=example>` in a code fence keeps its text visible instead of being silently deleted.

## Wiring triad

- **Caller**: `stream(request)` (`openai.ts:172`) builds the Set + `finish()` (`openai.ts:~305`) passes it to `extractHermesToolCalls`, reachable from the real `client.stream()` path.
- **Integration test**: golden `openai-leaked-dialect-safe-parse.golden.test.ts` drives the full SSE → accumulator → finish() path with `REQUEST.tools`; `test_flag_on_leaked_name_not_in_request_tools_is_not_recovered` + `test_flag_on_empty_request_tools_recovers_nothing` prove the gate end-to-end. Accumulator-level wiring tests confirm the ctor→finish threading.
- **Observability**: the pre-existing stderr recovery log (`openai.ts:312`) names recovered calls; gated-out blocks simply do not recover (no log), recovered ones log — the request-scoped decision is observable in the log's `names=` list.

## Edge cases (from `/edge-case-plan`)

- EC-5 residual data-loss (MUST-FIX) → fixed + `test_gate_residual_preserves_gated_out_block_text`.
- EC-1 trimmed-name → the name is already `.trim()`'d (`hermes-tool-extract.ts:72`); pinned by `test_gate_uses_same_trimmed_name_for_match_and_call`.
- EC-2 empty-tools leak stays visible → `test_flag_on_empty_request_tools_recovers_nothing` asserts `finish.text` contains `<function=`.
- EC-3 case-sensitive (DOCUMENT) → CHANGELOG notes exact/case-sensitive.

## Review round (4-agent) — fixes applied

See `.claude/knowledge-base/reviews/request-scoped-matching-review-2026-07-01.md`. Landed after IMPLEMENT, before READY_TO_MERGE:

- **MEDIUM (test):** exact-match untested (substring/superstring) → `test_gate_is_exact_not_substring_or_superstring`.
- **MEDIUM (test):** case-sensitivity untested → `test_gate_case_mismatch_leaked_name_is_not_recovered`.
- **MEDIUM (wiring):** drop-path observability — `HermesExtractResult.droppedNames` + stderr log in `openai.ts` finish() naming the dropped tools; `test_gate_reports_dropped_names_for_observability`.
- **LOW (arch):** docs.md:2967 now documents the request-scoped behavior of `extractToolCallsFromContent`.
- **LOW (test):** EC-5 test also asserts the promoted block is stripped; empty-tools golden asserts `stopReason`.

Correctness + architecture + wiring agents returned READY (EC-5 proven by trace + single-closure invariant); test-quality NEEDS_FIXES (the 2 boundary tests) — all addressed. R5 test count after review: **14 new tests** (12 hermes-file: 7 pure gate + 2 accumulator wiring + 3 review-round; 2 golden negative). Full suite green.

## Gate evidence

- `tests/internal/llm/hermes-tool-extract.test.ts` (9 new: 7 pure gate + 2 accumulator wiring) + `tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts` (2 new negative) = 11 new tests, green.
- Both changed source files: `hermes-tool-extract.ts` (88 → 110 LoC), `openai.ts` (+~8 lines). typecheck clean; biome clean.
- No public API change (`docs.md` unchanged — the allowlist is derived automatically from `request.tools`). No new dependency (deps-audit PASS).
- Full `pnpm validate` — **exit 0**: sdk **3073 passed / 36 skipped** (+11 R5 tests; no other test regressed by the request-scoping), publint + attw ✔, depcruise ✔ (439 modules, 0 violations, no new cross-layer import), knip + loc + duplication ✔, bundle-budget PASS.
