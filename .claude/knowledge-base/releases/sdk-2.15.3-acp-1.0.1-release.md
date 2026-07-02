# Release: @theokit/sdk@2.15.3 + @theokit/acp@1.0.1

**Date:** 2026-07-02
**Verdict:** RELEASED (PR #69 merged 2026-07-02T19:44:39Z; merge `0275461`; tags `@theokit/sdk@2.15.3` + `@theokit/acp@1.0.1` pushed; GitHub releases published; ROADMAP.md M0 flipped `[x]`)
**Milestone:** M0 (Harness security floor)
**Mechanism:** Changesets (`pnpm changeset version` consumed the 4 M0 changesets)
**Source review:** `knowledge-base/reviews/m0-harness-security-floor-review-2026-07-02.md` (READY_TO_MERGE)
**PR:** https://github.com/usetheodev/theokit-sdk/pull/69
**Release-prep commit:** `27fb7b5` (`chore(release): @theokit/sdk@2.15.3, @theokit/acp@1.0.1`)
**Pushed:** `develop` → `e020416` (pre-push `pnpm validate` gates passed: build/typecheck/test 3121-0/publint/attw/quality/bundle)

## Version bumps
- `@theokit/sdk` 2.15.2 → **2.15.3** (patch)
- `@theokit/acp` 1.0.0 → **1.0.1** (patch)
- `@theokit/example-deepagents-parity-demo`, `@theokit/example-theocode-e2e` — patch (internal consumers)

## Pending human gate
Per Unbreakable Rule 4, the release PR is NOT auto-merged. After a human approves + merges PR #69:
- tag the merge commit (Changesets style `@theokit/sdk@2.15.3` / `@theokit/acp@1.0.1`, or `changeset publish`),
- publish the GitHub release,
- **flip `ROADMAP.md M0 [ ] → [x]`** (cycle-release Step 7.5; the SDK `ROADMAP.md` M0 header) + append `knowledge-base/roadmap-runs/M0-2026-07-02.md`.

Until merge, M0 stays `[ ]` in `ROADMAP.md`.

## Notes
- Repo uses Changesets (not the generic `[Unreleased]` CHANGELOG); the `/release` skill flow was adapted accordingly (Rule 9).
- The PR diff syncs `main` with `develop` (main was behind; prior 2.15.x shipped via Changesets from develop). Version bump itself is M0-scoped.
- One pre-existing flaky telemetry test (`tests/telemetry/agent-send-parent-span.test.ts`, 42a3763 2026-06-07, unrelated to M0) flaked once under full-parallel load; passed 3/3 in isolation + on full re-run (3121/0). Non-blocking; candidate for a flake-fix follow-up.
