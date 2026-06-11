# Discover Edge Case Review — opencode-clone-theokit

Date: 2026-06-11
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/opencode-clone-theokit-plan.md
Research questions analyzed: 8
Edge cases found: 4 (MUST FIX: 2, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: Tools are in `tool/` not `command/` — 6 paths fabricated
- **Affected question:** Q3, Q6
- **Family:** Reference path / Citation
- **Scenario:** The plan cites `packages/opencode/src/command/registry.ts`, `command/tool.ts`, `command/read.ts`, `command/write.ts`, `command/shell.ts`, `command/schema.ts`. NONE of these exist. The actual paths are under `packages/opencode/src/tool/` (e.g., `tool/registry.ts`, `tool/read.ts`, `tool/write.ts`, `tool/shell.ts`).
- **Impact:** `/discover-execute` will fail to Read these files. `/discover-confidence` will cap to INVALID (fabricated citations).
- **Suggested fix:** Replace all `command/` references with `tool/` in Q3 and Q6 source paths.

### EC-2: Plan has no time budget per project
- **Affected question:** All (Q1-Q8)
- **Family:** Scope
- **Scenario:** The plan's Quality Rules require "Time-budget per project" but no budget is declared. The discovery plan template requires this per the skill spec.
- **Impact:** Halt-loop has no stop criterion based on time; scope creep risk.
- **Suggested fix:** Add "Time budget: OpenCode 4h, TheoKit SDK 2h" to the plan header or ADR section.

## SHOULD TEST

### EC-3: OpenCode uses Effect-TS heavily — agent.ts may be unreadable without Effect context
- **Affected question:** Q1
- **Suggested halt-loop checkpoint:** Before answering Q1, check if `agent.ts` imports from `effect` or `@effect/`. If yes, also read the Effect-TS pipe/Effect.gen patterns in the file header to understand the control flow (Effect-TS uses generators for async, not async/await).

## DOCUMENT

### EC-4: OpenCode has 2 copies of tools — `packages/opencode/src/tool/` AND `packages/core/src/tool/`
- **Accepted risk:** Both `opencode` and `core` packages contain `tool/registry.ts`, `tool/read.ts`, etc. The plan should investigate `packages/opencode/src/tool/` (the runtime package) and note the `core` copy as a shared library. No action needed — just awareness for the executor.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 0 | 1 (EC-3) | 0 |
| Q2 | 0 | 0 | 0 | 0 |
| Q3 | 1 | 1 (EC-1) | 0 | 0 |
| Q4 | 0 | 0 | 0 | 0 |
| Q5 | 0 | 0 | 0 | 0 |
| Q6 | 1 | 1 (EC-1) | 0 | 0 |
| Q7 | 0 | 0 | 0 | 0 |
| Q8 | 0 | 0 | 0 | 0 |
| All | 1 | 1 (EC-2) | 0 | 1 (EC-4) |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT — 2 MUST FIX: (1) fix 6 wrong paths `command/` → `tool/`, (2) add time budget.
