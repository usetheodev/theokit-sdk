# Edge Case Review — theocode-redistribution

Date: 2026-06-11
Tasks analyzed: 13
Edge cases found: 7 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: todolist nextId is module-level — ID collisions in multi-agent
- **Affected task:** T1.2
- **Family:** State
- **Scenario:** Two calls to `createTodolistTool()` in the same process (e.g., two agents each with their own todolist) share the same `nextId` counter. IDs are unique globally but semantically confusing — agent A's `todo-3` and agent B's `todo-4` are from different lists. If either agent serializes IDs to disk or passes them between contexts, the IDs are meaningless.
- **Impact:** ID collisions in multi-agent; confusing debugging when IDs skip numbers.
- **Suggested fix:** Move `let nextId = 1` inside `createTodolistTool()` so each instance has its own counter.

### EC-2: DirectoryGuard is redundant with SDK's path-guard — should NOT move to sdk
- **Affected task:** T2.4
- **Family:** Integration
- **Scenario:** `packages/sdk/src/internal/security/path-guard.ts` (407 LoC) already implements symlink escape prevention via `assertNoSymlinkEscape()` + `safePathJoin()` + approved directory lists. Moving DirectoryGuard (53 LoC) to sdk creates two overlapping security primitives in the same package, violating DRY and confusing consumers ("which one do I use?").
- **Impact:** API confusion; maintenance burden of two symlink-escape modules in the same package.
- **Suggested fix:** Remove T2.4 from the plan. Delete DirectoryGuard (treat it like the other redundant modules in Phase 3). Theocode callers should use SDK's `safePathJoin()` / `assertNoSymlinkEscape()` instead.

## SHOULD TEST

### EC-3: Re-export barrels resolve after original deletion (T4.1 + T4.3 ordering)
- **Affected task:** T4.1, T4.3
- **Suggested test:** `test_theocode_reexports_resolve_after_source_deletion` — import `createPlanModeTool` from `@theokit/theocode` after the original `.ts` file is deleted. Assert the re-export from `@theokit/sdk-tools` resolves correctly. This tests the barrel-only re-export pattern works with pnpm workspace linking.

### EC-4: skill-loader.ts left behind without plan mention
- **Affected task:** T1.1-T1.4 (missing)
- **Suggested test:** Verify `skill-loader.ts` is explicitly addressed. The plan moves 4 tools but `skill-loader.ts` (119 LoC, self-contained, zero theocode imports) is also a tool factory in the same directory. It was not mentioned in the plan. Decision needed: move it to sdk-tools too, or leave it in theocode with justification (e.g., it loads `.theokit/skills/` which is theocode-specific).

### EC-5: theocode E2E run.ts imports `createInvalidToolRepair` — will break after T3.3
- **Affected task:** T3.3
- **Suggested test:** Before deleting `invalid-repair.ts`, grep for `createInvalidToolRepair` in `examples/theocode-e2e/run.ts`. The plan says "only caller is the E2E test" but `run.ts` may import it. The deletion must also update `run.ts` to remove that import.

## DOCUMENT

### EC-6: theocode test count will drop after deletion
- **Accepted risk:** The plan says "195+ tests still passing" but some tests will be MOVED (not duplicated). After Phase 4.3 deletes original theocode test files, `pnpm --filter @theokit/theocode exec vitest run` will report fewer tests. The TOTAL across all packages remains >= 195, but theocode specifically drops from 195 to ~150. This is expected and correct — the building blocks' tests now live in their canonical packages.

### EC-7: pnpm workspace re-export requires @theokit/sdk-tools in theocode's dependencies
- **Accepted risk:** The plan mentions adding `@theokit/sdk-tools` and `@theokit/sdk` as dependencies of theocode (T4.1, task 3), but doesn't specify whether they should be `dependencies` or `peerDependencies`. For re-exports to work at runtime, they must be `dependencies` (not peer). Using `workspace:*` is correct for monorepo. Document this explicitly in the task.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 1 | 1 (EC-1) | 0 | 0 |
| T1.3 | 0 | 0 | 0 | 0 |
| T1.4 | 0 | 0 | 0 | 0 |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T2.3 | 0 | 0 | 0 | 0 |
| T2.4 | 1 | 1 (EC-2) | 0 | 0 |
| T2.5 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 0 | 0 | 0 | 0 |
| T3.3 | 1 | 0 | 1 (EC-5) | 0 |
| T4.1 | 1 | 0 | 1 (EC-3) | 1 (EC-7) |
| T4.2 | 0 | 0 | 0 | 0 |
| T4.3 | 0 | 0 | 0 | 0 |
| T4.4 | 0 | 0 | 0 | 1 (EC-6) |
| (missing) | 1 | 0 | 1 (EC-4) | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

Two MUST FIX items require plan changes before implementation:
1. **EC-1**: Move `nextId` inside factory function (1-line fix in T1.2)
2. **EC-2**: Remove T2.4 entirely; add DirectoryGuard to Phase 3 deletions (redundant with SDK's path-guard)

One SHOULD TEST item surfaces a plan gap:
- **EC-4**: Decide on `skill-loader.ts` — move to sdk-tools or explicitly leave in theocode with rationale
