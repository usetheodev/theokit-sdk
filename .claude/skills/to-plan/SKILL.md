---
name: to-plan
description: Turn the current conversation context into an implementation plan and save it to .claude/knowledge-base/plans/. Use when user wants to create a plan from the current context.
---

This skill takes the current conversation context and codebase understanding and produces a detailed implementation plan. Do NOT interview the user — synthesize what you already know.

## Process

1. **Explore the repo** to understand the current state of the codebase, if you haven't already. Read relevant files, understand existing patterns, conventions, and architecture.

2. **Architecture Snapshot (BEFORE)** — Run `/architecture-docs {domain}` for the affected domain(s). This saves the current-state C4 docs to `.claude/knowledge-base/architecture/{domain}/`. This is the baseline before the plan changes anything.

3. **Identify the modules** you will need to build or modify. Actively look for opportunities to extract deep modules (lots of functionality behind a simple, testable interface that rarely changes). Check with the user that these modules match their expectations and which modules need tests.

4. **Write the plan** using the template below and save it to `.claude/knowledge-base/plans/{slug}-plan.md`. The slug should be kebab-case derived from the plan title.

## Plan Template

Every plan MUST follow this structure. Each section is mandatory unless marked (optional).

<plan-template>

# Plan: {Title}

> **Version 1.0** — one-paragraph executive summary explaining what this plan does, why it matters, and what the expected outcome is.

## Context

What exists today, what's broken or missing, and what evidence (data, logs, user reports, benchmark results) motivates this work. Include links to issues, PRs, or ADRs when available.

## Objective

One clear sentence: what does "done" look like? Then a short list of specific, measurable goals.

## ADRs

Architecture Decision Records for this plan. Each decision gets:
- **ID** (D1, D2, ...) for cross-referencing in tasks
- **Decision** — what was decided
- **Rationale** — why this approach over alternatives
- **Consequences** — what this enables and what it constrains

## Dependency Graph

ASCII diagram showing phase dependencies. Example:

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3
                │                       │
                │                       ▼
                │               Phase 3.1
                │
                ▼
          Phase 4 (parallel)
```

Annotate which phases can run in parallel vs which are sequential blockers.

---

## Phase N: {Title}

**Objective:** one sentence describing what this phase achieves.

### T{N}.{M} — {Task Title}

#### Objective
What this specific task accomplishes.

#### Evidence
Data, logs, or observations that justify this task. Why it's needed NOW, not later.

#### Files to edit
```
path/to/file.rs — what changes and why
path/to/other.rs — what changes and why
```

#### Deep file dependency analysis
For each file listed above, explain:
- What the file does today
- How this task changes it
- What downstream files depend on this change

#### Deep Dives
Technical details for non-obvious aspects:
- Data structures: exact fields, types, derive macros
- Algorithms: step-by-step logic
- Invariants: what MUST be true before and after
- Edge cases: empty inputs, zero values, missing fields, backward compat

#### Tasks
Numbered checklist of atomic implementation steps:
1. Step one
2. Step two
3. ...

#### TDD
Strict RED-GREEN-REFACTOR cycle. List every test FIRST:

```
RED:     test_name() — what it asserts (this test MUST fail before implementation)
RED:     test_name_2() — what it asserts
GREEN:   Implement the minimal code to make all RED tests pass
REFACTOR: What cleanup is expected (or "None expected")
VERIFY:  cargo test -p {crate} / pytest {path}
```

#### Acceptance Criteria
Bulleted list of observable, verifiable conditions:
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Pass: /code-audit complexity check (cyclomatic complexity <= 10)
- [ ] Pass: /code-audit coverage check (coverage >= 90%)
- [ ] Pass: /code-audit lint check (zero warnings)
- [ ] Pass: /code-audit size check (file <= 500 lines)

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing
- [ ] Zero clippy warnings
- [ ] cargo test / pytest green
- [ ] code-audit checks passing

---

(Repeat `### T{N}.{M}` for each task in the phase)

(Repeat `## Phase N` for each phase)

---

## Coverage Matrix

Table mapping original gaps/requirements to tasks:

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Description | T{N}.{M} | How it's resolved |

**Coverage: X/Y gaps covered (Z%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing (Rust + Python where applicable)
- [ ] Zero clippy/lint warnings
- [ ] Backward compatibility preserved
- [ ] code-audit checks passing across all modified crates
- [ ] Plan-specific criteria (list them)
- [ ] **Dogfood QA PASS** — `/dogfood full` health score >= 70, zero CRITICAL issues
- [ ] **Runtime-metric proof** — for every task whose DoD references a runtime counter (hit rate, miss rate, fold count, etc.), the metric MUST be observed non-zero in a real workload against the wired binary path (smoke suite or dedicated scenario), not just verified to compile. Lesson from `sota-context-engineering` (commit `e67d134`): two prior dogfoods accepted "code exists + tests pass" and missed two real wiring bugs that only fired in benchmark workloads. See `.claude/rules/integration-first.md` §"Runtime-Metric Acceptance".

## Final Phase: Dogfood QA (MANDATORY)

> This phase runs AFTER all implementation phases are complete. The plan is NOT done until dogfood passes.

**Objective:** Validate that the implemented changes work as a real user would experience them, not just as unit tests assert.

### Execution

Run `/dogfood full`. Always full. No shortcuts.

### Acceptance Criteria

- [ ] Health score >= 70/100
- [ ] Zero CRITICAL issues introduced by this plan's changes
- [ ] Zero HIGH issues in commands/features modified by this plan
- [ ] Any pre-existing issues documented (not caused by this plan)

### If Dogfood Fails

1. Identify which issues are caused by this plan's changes vs pre-existing
2. Fix all plan-caused CRITICAL and HIGH issues before declaring the plan complete
3. Re-run `/dogfood full` to confirm fixes
4. Pre-existing issues are logged but do NOT block plan completion

</plan-template>

## Quality Rules

These rules are NON-NEGOTIABLE for every plan produced by this skill:

1. **Every task has TDD** — no task without RED-GREEN-REFACTOR cycle. Tests are listed BEFORE implementation steps.

2. **Every task has "Files to edit"** — exact paths, not vague references. If a file doesn't exist yet, say "(NEW)".

3. **Every task has "Deep file dependency analysis"** — understand what you're touching and what depends on it.

4. **Every task has acceptance criteria** — observable, verifiable conditions. Include code-audit checks.

5. **Every task has DoD** — definition of done with concrete verification commands.

6. **ADRs justify decisions** — no implementation detail appears without a rationale. If you chose approach A over B, say why.

7. **Dependency graph is explicit** — which phases block which. Which can parallelize.

8. **Evidence-driven** — every phase/task should reference concrete evidence (data, logs, code analysis) that justifies its existence. No speculative tasks.

9. **No file paths in ADRs** — ADRs describe architectural decisions, not implementation details. File paths go in tasks.

10. **Coverage matrix is complete** — every original requirement/gap maps to at least one task. 100% coverage is the target.

11. **Dogfood QA is mandatory** — every plan MUST include a final "Dogfood QA" phase. The plan is NOT complete until `/dogfood` passes. No exceptions. This is the "eat your own cooking" gate — if the product doesn't work as a user would experience it, the plan failed.

## Post-Plan: Edge Case Review

After saving the plan to `.claude/knowledge-base/plans/`, ALWAYS run the edge case review automatically:

```
/edge-case-plan {slug}
```

This invokes the `edge-case-plan` skill which analyzes the plan for unplanned edge cases — pragmatically, without over-engineering. If MUST FIX items are found, incorporate them into the plan before presenting the final version to the user.

## Post-Implementation: Cross-Validation (BEFORE dogfood)

After implementing all phases, BEFORE running `/dogfood`, run the cross-validation:

```
/cross-validation {slug}
```

This is the **most rigorous gate** in the pipeline. It reads the plan line by line and cross-references every task, ADR, TDD cycle, acceptance criterion, and DoD item against the actual code. Divergences are classified by severity (BLOCKER/CRITICAL/MAJOR/MINOR/INFO).

- **APROVADO** → proceed to `/dogfood`
- **REPROVADO** → fix divergences, then re-run `/cross-validation {slug}`
- **APROVADO COM RESSALVAS** → fix CRITICALs, then proceed to `/dogfood`

Report is saved to `.claude/knowledge-base/reviews/cross-validation/{slug}-xval-{YYYY-MM-DD}.md`.

## Post-Implementation: Architecture Diff (AFTER)

When the plan implementation is COMPLETE (all phases done, cross-validation passed, dogfood passed), run `/architecture-docs {domain}` again but output to the **diff** directory:

```
.claude/knowledge-base/architecture/{domain}/diff/
├── system-context.md
├── container-diagram.md
├── component-*.md
└── deep-dive.md
```

This captures the NEW architecture state after the changes. Then **ask the user**:

> "A implementação alterou a arquitetura do domínio `{domain}`. Os novos diagramas estão em `.claude/knowledge-base/architecture/{domain}/diff/`. Posso substituir os documentos principais em `.claude/knowledge-base/architecture/{domain}/` com a versão atualizada?"

- If **YES** → replace the main docs with the diff version, then delete the `diff/` directory.
- If **NO** → keep the diff for reference, do not touch the main docs.

This ensures architecture docs are always accurate and changes are explicitly approved.
