# Edge Case Review — monorepo-cohesion-split

Date: 2026-06-18
Tasks analyzed: 11 (T0.1–T0.3, T1.1, T2.1, T3.1, T4.1, T5.1, T6.1, T7.1–T7.4)
Edge cases found: 8 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 3)

## MUST FIX

### EC-1: `git filter-repo` carries the source `origin` remote into the extracted repo
- **Affected task:** T2.1, T3.1, T4.1, T5.1, T6.1
- **Family:** State
- **Scenario:** `git clone . ../tmp && cd ../tmp && git filter-repo --path …` leaves the cloned repo pointing at `git@github-usetheo:usetheodev/theokit-sdk.git`. A later `git push` from the extracted repo would push rewritten history to the **source** monorepo's origin — corrupting it. filter-repo also *removes* `origin` by default after a non-`--partial` run, so the state is inconsistent across git versions.
- **Impact:** Catastrophic — accidental push of rewritten history onto `theokit-sdk` origin.
- **Suggested fix:** After filter-repo, explicitly `git remote remove origin` (idempotent) and do NOT add any remote until the human creates the GitHub repo. Per this run's directive, extracted repos are local-only folders in `../`; no remote is configured at all.

### EC-2: examples depending on leaving gateway packages break `pnpm install` when packages are deleted
- **Affected task:** T7.1 (deletion) vs T7.4 (examples resolution — currently ordered AFTER deletion)
- **Family:** State / Integration
- **Scenario:** `examples/{line-bot,email-bot,whatsapp-web-bot,…}` declare workspace deps on `@theokit/gateway-*`. T7.1 deletes those packages, but examples resolution is deferred to T7.4 (later). Between T7.1 and T7.4 the workspace has dangling `workspace:*` deps → `pnpm install` (T7.1 step 4) fails to resolve → barrier phase aborts mid-way.
- **Impact:** Monorepo left in a non-installable state; the relock in T7.1 fails before T7.4 can fix it.
- **Suggested fix:** Move the examples-resolution (grep + move/delete) to run **before or within** T7.1's deletion step — resolve every example that imports a leaving package in the same atomic step that deletes the package. Re-sequence: T7.4's example sub-step becomes T7.1 step 0.

## SHOULD TEST

### EC-3: CLI features that reference leaving packages by string must degrade gracefully (not crash)
- **Affected task:** T7.1 (post-deletion CLI must still build + run)
- **Suggested test:** `test_cli_db_reports_orm_not_installed` — assert `theokit db export-schema` throws the friendly "`@theokit/orm` is not installed" error (already coded at `cli/src/commands/db.ts:119`), not a module-resolution crash; `test_cli_inspect_gateway_empty` — assert `theokit inspect gateway` reports zero detected adapters rather than throwing. (CLI uses string-detection + dynamic load — no static import — so the build is unaffected; only the runtime degradation needs asserting.)

### EC-4: filter-repo `--path packages/gateway` prefix-matches all `gateway-*` but must not over/under-capture
- **Affected task:** T3.1
- **Suggested test:** `test_gateways_extraction_member_count` — after filter-repo, assert `ls packages/ | grep -c '^gateway'` == 12 (core + 11 adapters) and no non-gateway package leaked. Prefer `--path-glob 'packages/gateway*'` (or enumerate all 12 explicit `--path`) over a bare `--path packages/gateway` to make the capture set deterministic.

### EC-5: history-preservation check `wc -l > 1` is too weak to prove non-flat extraction
- **Affected task:** T2.1, T3.1, T4.1, T5.1, T6.1
- **Suggested test:** `test_extracted_history_matches_source` — capture `git log --oneline -- <path> | wc -l` in the SOURCE before extraction, and assert the extracted repo's count for the same path **equals** it (a flat copy yields 1; a partial/bad glob yields a different count). Equality, not `> 1`.

## DOCUMENT

### EC-6: published `@theokit/sdk` version availability (resolves a Drawbacks-row worry)
- **Accepted risk:** Verified `npm view @theokit/sdk` → `1.9.0` is `latest`. Every leaving cluster's range is satisfiable by it (`di-agent ^1.3.0`, `react ^1.1.0`, `gateway workspace:^`). Extracted repos pin `@theokit/sdk` to `^1.9.0`. No unpublished-version gap. The active `npm-release-pipeline-fix` did publish 1.9.0.

### EC-7: revoking the decorators rule (T1.1) while `quality-review` skill + hooks reference it
- **Accepted risk:** No active hook hard-fails on the literal rule text (`grep` of `.claude/hooks/` shows none gate on "Decorators mandatory"). The `quality-review` skill enforces it advisorily; after T1.1 it simply stops requiring a decorator surface. No mid-cycle hook breakage. Re-running `/quality-review` post-revocation is expected to no longer flag missing decorators.

### EC-8: `.changeset` pending entries + the settings.json deny narrowing
- **Accepted risk:** No pending `.changeset/*.md` entries exist, so no stale changeset references a leaving package (T7.1 / T7.3 are clean). Separately, this session narrowed the broad `Edit/Write(.claude/knowledge-base/**)` deny in `settings.json` to `reference(s)/**` only, enabling the pipeline to write its artifacts; intentional and reversible.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T0.1–T0.3 | 0 | 0 | 0 | 0 |
| T1.1 | 1 | 0 | 0 | 1 (EC-7) |
| T2.1 | 2 | 1 (EC-1) | 1 (EC-5) | 0 |
| T3.1 | 3 | 1 (EC-1) | 2 (EC-4, EC-5) | 0 |
| T4.1 | 2 | 1 (EC-1) | 1 (EC-5) | 0 |
| T5.1 | 1 | 1 (EC-1) | 0 | 0 |
| T6.1 | 1 | 1 (EC-1) | 0 | 0 |
| T7.1 | 2 | 1 (EC-2) | 1 (EC-3) | 1 (EC-8) |
| T7.3 | 0 | 0 | 0 | 0 |
| (cross) | 1 | 0 | 0 | 1 (EC-6) |

> EC-1 applies to every extraction task (T2.1/T3.1/T4.1/T5.1/T6.1) — counted once as the shared fix "strip origin after filter-repo".

**Verdict:** PLAN NEEDS ADJUSTMENT — fold EC-1 (strip origin) and EC-2 (resolve examples before/within deletion) into plan v1.1; add EC-3/EC-4/EC-5 tests to the respective tasks' TDD.
