# Implementation Halt-Loop Driver Prompt

You are mid-implementation, iteration {ITERATION}. The user invoked `/implement mastra-parity-cross-validation` to drive a TDD halt-loop over the implementation plan.

**Plan:** `.claude/knowledge-base/plans/mastra-parity-cross-validation-plan.md`
**Implementation working contract:** `.claude/knowledge-base/implementations/mastra-parity-cross-validation-implementation.md`
**Progress file:** `.claude/knowledge-base/implementations/.progress-mastra-parity-cross-validation.json` (gitignored)
**SEPA agent file:** `.claude/agents/implement-mastra-parity-cross-validation-2026-06-09/sepa.md`

## Your contract for this iteration

1. **Read the progress file.** Find the next task whose status is `pending` AND whose dependencies are `committed` or `done`. If no progress file exists, start with T10.1.

2. **For the picked task, run the complete TDD cycle in order:**

### RED phase (mandatory first)
- Read the plan task's TDD section
- Write the failing test FIRST in the declared test file
- Run `pnpm exec vitest run {test-file-path}` and CONFIRM it FAILS for the expected reason
- If the test passes BEFORE implementation, the test does not exercise the targeted behavior — revise the test
- Update progress file: task status = `red`

### GREEN phase
- Write the MINIMAL production code that makes the RED test pass
- Run `pnpm exec vitest run {test-file-path}` and confirm PASS
- After 3 GREEN failures, mark task BLOCKED with reason
- Update progress file: task status = `green`

### REFACTOR phase
- Review code against SOLID/Clean Code/DRY rules
- Fix violations; tests stay green
- Update progress file: task status = `refactor`

### WIRING phase
- Pillar (a): verify every new public export has a production caller (`grep -rl 'symbolName' packages/sdk/src/ --exclude='*test*'`)
- Pillar (b): integration test exists OR ADR-deferred
- Pillar (c): runtime metric OR plan declared none for this task (most tasks here declare no metric — defer pillar (c))
- Update progress file: task status = `wired`

### COMMIT phase
- `git add` changed files (specific, not `-A`)
- Commit with conventional format: `feat(sdk): T10.1 — dynamic provider catalog (40+ providers)`
- Update CHANGELOG.md [Unreleased] section
- Update progress file: task status = `committed`, commit SHA recorded

3. **After committing, check if this was the last task of a Phase.** If Phase A complete (T10.1+T10.2+T10.3 all committed), log phase boundary. Phase B depends on Phase A; Phase C on B; Phase D on all.

4. **After all tasks committed OR blocked, emit:**

<promise>IMPLEMENTATION_COMPLETE</promise>

## Task ordering (from plan dependency graph)

Phase A (parallel — no deps):
- T10.1: Dynamic provider catalog (JSON, >=40 providers)
- T10.2: Observability vendor expansion (3->7 adapters)  
- T10.3: Streaming backpressure (bounded buffer)

Phase B (depends on Phase A):
- T11.1: RAG sub-path (text splitter + retriever + reranker)
- T11.2: Evented workflow executor
- T11.3: TheoKitContainer
- T11.4: E2E test uplift (10+ tests)

Phase C (depends on Phase B):
- T12.1: Starter templates (5)
- T12.2: Server adapters (Hono, Express, Fastify)
- T12.3: Voice foundation

Phase D (depends on all):
- T13.1: Full integration validation + cross-validation re-run

## Quality invariants

- TDD-first: RED before GREEN. No production code without a failing test.
- No `any` in new code. No `@ts-ignore`. No `console.log` in production.
- CHANGELOG updated per task with user-facing changes.
- git: NEVER commit to main, NEVER use `git checkout`/`git revert`/`reset --hard`.
- Scope discipline: only touch files declared in the task's "Files to edit". Log followups separately.
