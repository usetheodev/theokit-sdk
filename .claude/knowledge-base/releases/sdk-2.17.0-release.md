# Release: @theokit/sdk@2.17.0 — M2 Harness resilience & I/O robustness

**Date:** 2026-07-03
**Verdict:** PR_OPEN_AWAITING_APPROVAL
**Milestone:** M2 (Harness resilience & I/O robustness)
**Mechanism:** Changesets (`pnpm changeset version` consumed the 4 M2 changesets: m2-59/60/61/63)
**Source review:** `knowledge-base/reviews/m2-harness-resilience-review-2026-07-02.md` (READY_TO_MERGE)
**PR:** https://github.com/usetheodev/theokit-sdk/pull/72
**Release-prep commit:** `cb9b5a1` (`chore(release): @theokit/sdk@2.17.0`)
**Follow-up G8 fix:** `265ad2c` (`refactor(llm): extract mapOpenAIFinish to finish.js`)
**Pushed:** `develop` → `265ad2c` (pre-push `pnpm validate` gates passed on the accepted run: build/typecheck/test 3183-0/naming/publint/attw/knip/cycles/depcruise/loc/duplication/bundle)

## Version bumps
- `@theokit/sdk` 2.16.0 → **2.17.0** (minor — 4 changesets all minor)
- `@theokit/example-deepagents-parity-demo`, `@theokit/example-theocode-e2e` — patch (internal consumers)

## Issues closed (4)
- **#60** full-jitter backoff on 429 + provider circuit breaker (relocated `CircuitBreaker` → `internal/resilience/`).
- **#61** SSE idle timeout + truncation typed-error + tool-call jsonrepair-before-`{raw}`.
- **#59** MCP stdio reconnect-after-drop (detect exit/timeout → reconnect bounded; shared handshake).
- **#63** conversation batch append + cross-process file lock + pagination.

## Release-cycle notes
- Repo uses Changesets (not the generic `[Unreleased]` CHANGELOG); the `/release` skill flow was adapted accordingly (Rule 9).
- **G8 LoC gate fixed mid-release:** the #61 truncation additions pushed `openai.ts` to 403 SLOC (budget 400). Extracted the pure `mapOpenAIFinish` mapper to `finish.js` (its logical home) — `openai.ts` back to 391, behavior-preserving. Committed as `265ad2c`.
- **Environmental test flakiness (per-user decision: re-run until clean).** Under full-turbo pre-push load the suite intermittently failed 1 rotating test — `tests/telemetry/agent-send-parent-span.test.ts` (OTel span-collector contention) OR `tests/memory-class-peer-routing.test.ts` (better-sqlite3 native / `/tmp` ENOTDIR). Both pass in isolation (3/3, 2/2) and neither is touched by M2 (no telemetry/sqlite-open changes). All non-test gates verified green individually. Per the M0/M1 precedent and the user's choice, the push was re-run until a clean full-suite run passed the gate — succeeded on the accepted attempt. The flakes are a pre-existing test-infra gap (candidate for a follow-up stabilization slice), not an M2 regression.

## Pending human gate
Per Unbreakable Rule 4, the release PR is NOT auto-merged. After a human approves + merges PR #72:
- tag the merge commit (`@theokit/sdk@2.17.0`),
- publish the GitHub release,
- **flip `ROADMAP.md M2 [ ] → [x]`** (cycle-release Step 7.5; SDK `ROADMAP.md` M2 header) + append `knowledge-base/roadmap-runs/M2-2026-07-03.md`.

Until merge, M2 stays `[ ]` in `ROADMAP.md`.
