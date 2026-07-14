# Release @theokit/sdk@3.2.0

**Date:** 2026-07-14
**Verdict:** RELEASED
**Bump:** minor (changesets — .theokit/rules path-scoped rules)
**PR:** https://github.com/usetheodev/theokit-sdk/pull/109
**Merge commit:** 4e7087a945d02d1330c402a855a07437f25a5b89
**Tag:** @theokit/sdk@3.2.0
**GitHub release:** https://github.com/usetheodev/theokit-sdk/releases/tag/@theokit/sdk@3.2.0
**npm:** https://www.npmjs.com/package/@theokit/sdk/v/3.2.0

## Cycle
discover (2 research loops) -> plan (coverage 100%) -> implement (TDD, 4 phases) ->
review (2 specialist agents, all findings fixed) -> release.

## Notes
- Added `.theokit/rules/*.md` path-scoped rules + `SendOptions.contextPaths`.
- Fixed shared glob compiler (`**/` collapse; `*`/`?` no longer cross `/`).
- Evidence: full suite 3543 passed / 36 skipped; typecheck 0; biome clean; 3 E2E contract;
  deterministic example green. Blueprint + plan in .claude/knowledge-base/.
- Ad-hoc release (no milestone_id) — ROADMAP checkbox flip skipped by design.
