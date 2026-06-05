# Cycle: IMPLEMENT

Source of Truth for the implementation cycle.

## Purpose

Execute a confidence-approved plan into code, tests, and commits. TDD-disciplined, halt-loop driven.

## Pre-conditions

- A plan exists at `knowledge-base/plans/{slug}-plan.md` with verdict ≥ SHIPPABLE_WITH_CAVEATS.
- The repository is on a branch other than `main` (per Unbreakable Rule 4 — work on `develop` or a feature branch).
- The project bootstrapped its language toolchain (e.g., `go.mod`, `package.json`, `pyproject.toml`, `Cargo.toml`).

If any pre-condition fails, refuse and surface the missing item.

## Chain (per task in the plan)

Each task runs as a halt-loop iteration:

```
RED      — write the failing test that captures the task's acceptance criterion
GREEN    — minimal code to pass the test
REFACTOR — improve structure; tests stay green
WIRING   — caller + integration test + runtime metric (the "wiring triad")
COMMIT   — atomic commit referencing the plan slug and task ID
```

## Wiring triad

A task is **not** complete until all three are present:

1. **Caller** — production code path that exercises the new behavior end-to-end.
2. **Integration test** — covers the boundary the unit test mocked.
3. **Runtime metric** — counter, histogram, or log line that lets ops see the new behavior in production. Without observability, the feature is invisible when it breaks.

## Hard gates (per iteration)

- Test suite green before commit.
- Linter clean (project-specific — see `rules/code-quality-languages.txt`).
- No new symbols left dangling (every new function/class has a caller or a test exercising it).
- CHANGELOG `[Unreleased]` updated (Unbreakable Rule 6).

## Hard gates (post-halt-loop, before `IMPLEMENTATION_COMPLETE` is honored)

`scripts/run_validation.py` runs after the promise marker and BEFORE the handoff:

- npm test / typecheck / lint / coverage gates (when applicable).
- Wiring triad summary (caller + integration test + runtime metric).
- **`/code-quality` verdict ∉ {FAIL_HARD, INVALID}** (per ADR 0002 — `cq-gate-in-validate`). FAIL_SOFT and PASS_WITH_CAVEATS surface as WARN in the report but do not block. Override only with `--no-code-quality` (pre-code phase or CQ not installed).

## Stop conditions

- Hard gate fails twice on the same task → halt-loop pauses, escalate to human.
- Plan task list exhausted → emit completion promise (`IMPLEMENTATION_COMPLETE`).

## Anti-patterns

- Writing production code before the failing test (skipping RED).
- Skipping REFACTOR because "tests are green" — the cycle is RED → GREEN → REFACTOR, not RED → GREEN → ship.
- WIRING done in a separate PR ("I'll wire it later"). Later never comes.
- Commits that mix multiple tasks. Each commit references one task ID.
- Editing the plan during implementation. If the plan was wrong, return to `/to-plan`.

## Output

- Commits on the working branch.
- `knowledge-base/implementations/{slug}/` — per-iteration logs.
- `knowledge-base/implementations/{slug}-implementation.md` — final summary with wiring triad checklist per task.

## Cross-references

- Schema for cycle rules: `rules/cycle-rule-schema.md`
- Skill: `skills/implement/SKILL.md`
- Conventions: `rules/architecture.md`, `rules/testing.md`, `rules/loop-engine-convention.md`
- Upstream: `rules/cycle-plan.md` (plan must reach verdict ≥ SHIPPABLE_WITH_CAVEATS)
- Downstream: `rules/cycle-code-quality.md` (runs after `IMPLEMENTATION_COMPLETE`)
