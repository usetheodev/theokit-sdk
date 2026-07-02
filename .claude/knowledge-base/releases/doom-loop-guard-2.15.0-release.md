# Release @theokit/sdk@2.15.0

**Date:** 2026-07-01
**Verdict:** RELEASED
**Mechanism:** changesets (npm publish) — NOT the generic semver develop→main PR flow (this SDK ships via changesets; tags are `@theokit/sdk@X.Y.Z`, published to npm).
**Source review:** `.claude/knowledge-base/reviews/doom-loop-guard-review-2026-07-01.md` (READY_TO_MERGE)
**Bump:** minor (`2.14.0` → `2.15.0`) — new public API surface (`SendOptions.doomLoop`, `RunResult.stoppedByDoomLoop`, `DoomLoopThresholds`).
**Release commit:** `a157ca8` (`chore(release): @theokit/sdk@2.15.0`) on `develop` (pushed `f5463a9..a157ca8`).
**Tag:** `@theokit/sdk@2.15.0` (annotated, pushed → `d5e28ee`).
**npm:** published + verified (`npm view @theokit/sdk@2.15.0` → 2.15.0; published as `usetheodev` with `--provenance=false`; token written to `~/.npmrc` for the publish and removed immediately after).

## What shipped

**Doom-loop / no-progress guard** for the agent loop:
- Pure `DoomLoopTracker` (`internal/agent-loop/doom-loop-tracker.ts`) — canonical key-sorted-JSON signature (NUL-delimited, collision-proof) + consecutive-identical counter; soft (nudge once) → hard (stop) escalation; thresholds validated fail-fast (`ConfigurationError`).
- Wired into `continueOrTerminate` via `inspectDoomLoop`; hard verdict sets `ctx.stoppedByDoomLoop`, emits a resumable stop message, stops the run; surfaced as `RunResult.stoppedByDoomLoop` → `classifyRound` → terminal `no_progress`.
- Public: `SendOptions.doomLoop: false | { softThreshold, hardThreshold }` — default-ON (soft 3 / hard 5). Observability: `stoppedByDoomLoop` OTel span attribute.
- Complements (does not replace) the empty-round `no_progress`. Dependency-free. Closes the qwen3-coder identical-repeat hang that previously ground to the iteration ceiling.

## Cycle provenance

Full CYCLE (discover 89.0 → plan 90.0 → implement TDD T1.1–T4.1 → code-quality → review 5-agent → READY_TO_MERGE). Review caught + fixed a BLOCKER (literal NUL byte in source) + a HIGH (missing `inspectDoomLoop` loop-driven test) + MEDIUMs (fail-fast validation, observability, docs honesty). Commits `d7057f2 → b42f4b5` (feature) + `a157ca8` (release).

## Gate evidence

`pnpm validate` green (pre-push, both pushes): @theokit/sdk 3062 passed / 36 skipped, publint + attw + knip + depcruise (439 modules, 0 violations) + loc + duplication + bundle-budget all pass.

## Notes

- Advisory `sdk-2-0:pre-publish` flags 5 `peer-version-consistency` items (siblings pin `@theokit/sdk >=1.7.0`, a floor that spans to major 2) — pre-existing false-positive, identical at 2.14.0; not a publish-path gate (no `prepublishOnly` hook). Not a blocker.
