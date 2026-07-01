# Release @theokit/sdk@2.15.2

**Date:** 2026-07-01
**Verdict:** RELEASED
**Mechanism:** changesets (npm publish) — tags are `@theokit/sdk@X.Y.Z`, published to npm.
**Source review:** `.claude/knowledge-base/reviews/stream-boundary-normalization-review-2026-07-01.md` (READY_TO_MERGE)
**Bump:** patch (`2.15.1` → `2.15.2`) — a streaming-behavior fix, no new public API.
**Release commit:** `81220c5` (`chore(release): @theokit/sdk@2.15.2`) on `develop`.
**Tag:** `@theokit/sdk@2.15.2` (annotated, pushed).
**npm:** published + verified (`npm view @theokit/sdk@2.15.2` → 2.15.2; published as `usetheodev` with `--provenance=false`; token written to `~/.npmrc` for the publish and removed immediately after).

## What shipped

**Stream-boundary leaked-dialect suppression (R7)** — the largest technique (T1) of the tool-calling-robustness blueprint, gated on R5 + R6 (both shipped):
- `OpenAIStreamAccumulator` now HOLDS back `text_delta` events for content that could still be a leaked `<function=NAME>` tool call (a `StreamSuppressionBuffer` + the pure `streamToolCallBufferState` FSM, reusing R5's request-scoped allowlist as exact + a streaming prefix probe), so the raw dialect never flashes by in the live stream nor lands in the final assistant text.
- `finish()` (R5 recovery) keeps doing promotion — no mid-stream promotion (the loop derives the final text from `accumulatedText`, so holding deltas suffices).
- Gated by `extractToolCallsFromContent`; flag-off streaming is byte-for-byte unchanged. Fail-open: a never-closing marker or un-suppressable input is flushed as visible text; held text is drained post-loop even if the stream omits a `finish_reason` terminal.

## Cycle provenance

Full CYCLE (discover 89.0 → plan 90.4 → implement TDD T1.1/T2.1 → code-quality → review 4-agent → READY_TO_MERGE). Review caught 5 MEDIUM real defects (mixed-delta suppression, silent-drop fail-loud, native-call divergence, missing fail-open test, exact-vs-prefix test) — all fixed. Commits `6336f81 → 0f9f3ed` (feature) + `81220c5` (release).

## Gate evidence

`pnpm validate` green: @theokit/sdk 3103 passed / 36 skipped, publint + attw + knip + depcruise (0 violations) + **G8 (all files ≤ 400 LoC — StreamSuppressionBuffer extracted to keep openai.ts under the cap)** + duplication + bundle all pass.

## Blueprint completion

R7 completes the tool-calling-robustness blueprint: P0 (`2.13.1`) → tool-input sanitization (`2.14.0`) → R6 doom-loop guard (`2.15.0`) → R5 request-scoped matching (`2.15.1`) → R7 stream-boundary suppression (`2.15.2`).

## Notes

- The earlier full-validate runs flaked once each on `tests/telemetry/agent-send-parent-span.test.ts` — the documented `.githooks/pre-push:11` native-binding parallel-contention flake (fixture-mode, code-path-isolated from R7). Clean re-run: 0 failed. Not R7-caused; not a new issue.
