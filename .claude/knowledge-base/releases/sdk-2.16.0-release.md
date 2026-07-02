# Release: @theokit/sdk@2.16.0 — M1 Harness correctness core

**Date:** 2026-07-02
**Verdict:** RELEASED (PR #71 merged 2026-07-02T22:12:36Z; merge `49bdfef`; tag `@theokit/sdk@2.16.0` pushed; GitHub release published; ROADMAP.md M1 flipped `[x]` in commit `53bdf8d`)
**Milestone:** M1 (Harness correctness core — kill silent no-ops & dead safety)
**Mechanism:** Changesets (`pnpm changeset version` consumed the 4 M1 changesets: m1-55/57/58/65)
**Source review:** `knowledge-base/reviews/m1-harness-correctness-review-2026-07-02.md` (READY_TO_MERGE)
**PR:** https://github.com/usetheodev/theokit-sdk/pull/71
**Release-prep commit:** `ff61080` (`chore(release): @theokit/sdk@2.16.0`)
**Follow-up wiring commit:** `1f14153` (`fix(job-queue): export JobQueueOptions from public barrel`)
**Pushed:** `develop` → `1f14153` (pre-push `pnpm validate` gates passed: build/typecheck/test 3154-0/knip/publint/attw/quality/loc/duplication/bundle)

## Version bumps
- `@theokit/sdk` 2.15.3 → **2.16.0** (minor — 4 changesets all minor)
- `@theokit/example-deepagents-parity-demo`, `@theokit/example-theocode-e2e` — patch (internal consumers)

## Issues closed (4)
- **#55** permission fail-closed + argument-level matching (`ArgMatcher`, default `allow`→`ask`).
- **#58** AbortSignal→dispatch + per-tool timeout + between-iteration abort + JobQueue maxConcurrency.
- **#65** wire the 7 dead plugin hooks + ToolContext 2nd arg.
- **#57** opt-in tool-result content guard (delimit + PII redaction).

## Behavior change flagged at the human gate
- **#55** flips the no-rule-matched default from `"allow"` (fail-open) to `"ask"` (fail-closed). Shipped as **minor** (M0 precedent: security-hardening behavior tightening ships non-major; type signatures backward-compatible). Restore via `new PermissionEngine(rules, { defaultAction: "allow" })`. PR body asks the approver to request a major cut if preferred.

## Release-cycle notes
- Repo uses Changesets (not the generic `[Unreleased]` CHANGELOG); the `/release` skill flow was adapted accordingly (Rule 9).
- **Environmental blocker resolved mid-release:** an empty orphan `/tmp/.git` directory (not a repo, not created by this work) made `findGitRoot` walk up from `os.tmpdir()` and match it, failing `context-discovery.test.ts` at the pre-push gate. With explicit user authorization, the empty dir was removed (`rmdir`, non-destructive — fails if non-empty); suite then clean at 3154-0.
- **knip finding fixed mid-release:** `JobQueueOptions` was exported from `job-queue.ts` but not re-exported from the public barrel → orphan export. Fixed by re-exporting from `index.ts` (consistent with every other public class+options pair), completing the `new JobQueue({ maxConcurrency })` surface. Committed as `1f14153`.

## Pending human gate
Per Unbreakable Rule 4, the release PR is NOT auto-merged. After a human approves + merges PR #71:
- tag the merge commit (`@theokit/sdk@2.16.0`),
- publish the GitHub release,
- **flip `ROADMAP.md M1 [ ] → [x]`** (cycle-release Step 7.5; SDK `ROADMAP.md` M1 header) + append `knowledge-base/roadmap-runs/M1-2026-07-02.md`.

Until merge, M1 stays `[ ]` in `ROADMAP.md`.
