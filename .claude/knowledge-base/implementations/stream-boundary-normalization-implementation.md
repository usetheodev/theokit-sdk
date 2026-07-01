# Implementation summary — stream-boundary-normalization (R7)

Plan: `.claude/knowledge-base/plans/stream-boundary-normalization-plan.md` (SHIPPABLE 90.4)
Blueprint: `.claude/knowledge-base/discoveries/blueprints/stream-boundary-normalization-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89.0)
Verdict: **IMPLEMENTATION_COMPLETE** · 2026-07-01 · branch `develop`

## Commits (TDD, atomic)

| Task | Commit | What |
|---|---|---|
| T1.1 | `6336f81` | pure `streamToolCallBufferState` FSM in `hermes-tool-extract.ts` (2-state hold/flush, case-sensitive marker, R5 Set exact + prefix probe, over-cap fail-open); 9 unit tests + CHANGELOG + changeset (patch) |
| T2.1 | `78076fe` | `OpenAIStreamAccumulator` holds `text_delta` while `"possible"`, flushes on `"impossible"`, terminal residual flush at `finish_reason`; gated by `extractFromContent`; `consume()` split into `applyChoice`; 7 accumulator + 1 golden test |

## Design (per blueprint + plan ADRs)

- **D1** — suppression-only: hold `text_delta` for content that could still be a `<function=NAME>` tool call; `finish()` (R5) keeps doing promotion; `this.text` stays whole. The loop derives the final text from `accumulatedText` (`loop-llm-stream.ts:109`), so holding deltas alone makes both the live `onDelta` view AND the final text clean — no loop change.
- **D2** — the matcher is R5's `allowedToolNames` Set (`has` exact) + `someToolNameStartsWith` (streaming prefix probe).
- **D3** — small cap (8 KB); over-cap → `"impossible"` → flush (fail-open, never hang).
- **EC-1 (MUST-FIX)** — the marker match is CASE-SENSITIVE (no `.toLowerCase()`), identical to `HERMES_BLOCK`, so the FSM never holds a block `extractHermesToolCalls` won't recover.
- **Terminal reconciliation** — at the `finish_reason` chunk, `flushHeldTextAtTerminal` emits `extractHermesToolCalls(heldText, …).residualText` (held minus recoverable blocks) so `accumulatedText == finish.text`.

## Wiring triad

- **Caller**: `OpenAIStreamAccumulator.applyContentDelta` (buffer) + `consume`/`applyChoice` (terminal flush) on the real `client.stream()` path; the R5 `allowedToolNames` Set is already built in `stream()`.
- **Integration test**: golden `test_flag_on_leaked_call_is_not_streamed_as_text` (full SSE → the collected `text_delta` events contain no `<function=` while `finish.toolCalls` recovers the call) + 7 accumulator tests (hold, flush prose, flush unallowed, terminal==finish, flag-off, terminal-chunk EC-2, held-still-recovered EC-3).
- **Observability**: the pre-existing R5 recover/drop stderr logs in `finish()` still fire; holding is transparent (fewer `text_delta` events).

## Gate evidence

- `tests/internal/llm/hermes-tool-extract.test.ts` (16 new: 9 FSM + 7 accumulator) + golden (1 new) = 17 new tests, green. 49 tests across the two files.
- `hermes-tool-extract.ts` (121 → 181 LoC), `openai.ts` (518 → 562 LoC — +44; the `applyChoice` extraction was required by the cognitive-complexity gate, still well under the 500-per-symbol / file budget). typecheck clean; biome clean; NUL 0.
- No public API change (`docs.md` — the suppression is automatic behavior of the existing `extractToolCallsFromContent` flag; the R5 doc note already covers request-scoping). No new dependency (deps-audit PASS).
- Full `pnpm validate` — pending (Integration Validation phase).

## Known limitations (fail-open, documented — no regression)

- A delta mixing prose + `<function=` marker in ONE delta streams as text (not suppressed); `finish()` still recovers.
- Once the buffer starts with `<function=<allowed>`, trailing prose after the tool call is held until the terminal (flushed then), not live — rare.
- `n>1` (multiple streamed choices) not supported (SDK requests single completion).
