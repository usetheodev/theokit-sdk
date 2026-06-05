---
name: discover-execute
description: Executes a discovery plan via halt-loop (ralph-loop-style autonomous iteration) over the sources declared in the plan — local references under knowledge-base/references/ e/ou URLs allowlisted via rules/discover-web-allowlist.txt. Produces a technical blueprint at knowledge-base/discoveries/blueprints/{slug}-blueprint.md. Use after /discover-edge-cases has approved the plan.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit Skill
argument-hint: "{plan-slug} [--max-iterations 30]"
---

# Discover-Execute — Halt-Loop Deep-Research Driver

Reads an approved discovery plan, then drives a halt-loop investigation across `.claude/knowledge-base/references/` (Project A, Project B, Project C), producing a structured technical blueprint.

**Architecture:** wraps the `ralph-loop` plugin's autonomous-iteration mechanism (Stop hook + state file) with a discovery-specific prompt template. Each iteration answers one or more research questions from the plan, appends to the blueprint, and re-evaluates "are all questions answered + all citations real + all coverage corners covered?"

**Halt condition:** the loop emits `<promise>BLUEPRINT_COMPLETE</promise>` only when ALL of:

1. Every research question from the plan is answered in the blueprint.
2. Every citation (file/symbol) in the blueprint exists in `.claude/knowledge-base/references/`.
3. All four coverage corners (tests / deps / tools / techniques) have at least one populated subsection.
4. Acceptance criteria from the plan are observably met.

## Cycle contract

This skill is **phase 3** of [`cycle-discover`](../../rules/cycle-discover.md). The cycle rule is the source of truth for chain order, hard gates (path existence, halt-loop conditions, fabricated citation refusal), stop conditions (3-retry Fase A, time budget exhaustion), anti-patterns (never modify .claude/knowledge-base/references/, never fabricate Fase B answers), and rollback. **Read `cycle-discover.md` before invoking this skill.** This SKILL.md retains phase-specific detail (halt-loop workflow, per-iteration prompt, halt-loop invariants).

## When to Trigger

- After `/discover-edge-cases {slug}` returned `DISCOVERY PLAN OK` (or MUST FIX absorbed).
- User explicitly invokes `/discover-execute {slug}` to launch the autonomous loop.

## Workflow

### Step 1 — Argument parsing

Accept:

- `/discover-execute {slug}`
- `/discover-execute {slug} --max-iterations 30`
- `/discover-execute {slug} --time-budget 60min`

Defaults:

- `--max-iterations`: `30`
- `--time-budget`: derived from the discovery plan's per-project budget; default `60min` total if absent

### Step 2 — Resolve plan + initialize blueprint

1. Resolve plan path: `.claude/knowledge-base/discoveries/plans/{slug}-plan.md`.
2. Read it fully. Extract: in-scope projects, research questions, coverage matrix, halt-loop checkpoints.
3. Create the blueprint file at `.claude/knowledge-base/discoveries/blueprints/{slug}-blueprint.md` using `.claude/skills/discover-execute/templates/blueprint-template.md` as the starter.
4. The blueprint starts with all sections present but EMPTY (each section has a `<!-- TBD: Qx -->` placeholder mapping to the research question).

### Step 3 — Build the halt-loop prompt

Read `.claude/skills/discover-execute/prompts/execute-mode-prompt.md` and substitute:

- `{PLAN_SLUG}` — the slug
- `{PLAN_PATH}` — the resolved plan path
- `{BLUEPRINT_PATH}` — the resolved blueprint path
- `{MAX_ITERATIONS}` — iteration limit
- `{TIME_BUDGET}` — total time budget

### Step 4 — Invoke ralph-loop (shell-safe positional + flags)

**Read `.claude/rules/loop-engine-convention.md § How to invoke ralph-loop:ralph-loop safely` BEFORE this step.** The ralph-loop positional argument is shell-evaluated; inlining a multi-section driver prompt (backticks / fenced code blocks / `$(...)`) breaks loop startup with a bash parse error. Use the file-referenced pattern.

1. Write the substituted prompt from Step 3 to `.claude/halt-loop-prompts/discover-execute-{plan-slug}.md` (gitignored).
2. Invoke `ralph-loop:ralph-loop` with:
   - Positional prompt (no shell metachars): `Read .claude/halt-loop-prompts/discover-execute-{plan-slug}.md and follow its instructions for this halt-loop iteration.`
   - `--completion-promise 'BLUEPRINT_COMPLETE'`
   - `--max-iterations N`

The ralph-loop plugin:

- Writes `.claude/ralph-loop.local.md` (state file)
- Activates the Stop hook
- Feeds the positional prompt back to Claude on each session-exit attempt (Claude re-reads the driver file each iteration)
- Detects `<promise>BLUEPRINT_COMPLETE</promise>` to terminate

### Step 5 — Per-iteration contract

Each iteration of the halt-loop MUST:

1. **Pick the next un-answered research question** from the plan's Coverage Matrix.
2. **Apply the planned method** (Read / Grep / find / git log) using the planned reference project + path. Never `cd` into `.claude/knowledge-base/references/`; never modify it (boundary-check hook blocks).
3. **Synthesize the answer** in the format declared by the plan's "expected answer shape".
4. **Append/update the blueprint** under the section mapped to that question. Replace the `<!-- TBD: Qx -->` placeholder.
5. **Cite the source** — every paragraph or table cell that references behavior MUST link to a `.claude/knowledge-base/references/{project}/{path}:{line}` reference. No claim without citation.
6. **Mark the question DONE** in a session-local progress file under `.claude/knowledge-base/discoveries/.progress-{slug}.json` (gitignored).
7. **Re-evaluate halt condition.** If all four conditions hold (every question answered + every citation verifiable + four corners populated + acceptance criteria met), emit `<promise>BLUEPRINT_COMPLETE</promise>`.

If a research question cannot be answered (e.g., the cited path doesn't exist after all), the iteration:

- Adds a `<!-- BLOCKED: reason -->` comment in the blueprint at that section.
- Lists the blocked question in the progress file.
- Continues to the next question.
- Does NOT emit `BLUEPRINT_COMPLETE` — instead reports honestly that N questions remained blocked.

### Step 6 — Report

After the loop terminates (promise detected OR max iterations OR time budget):

- Path to the produced blueprint
- Number of iterations used
- Questions answered / questions blocked
- Citations verified count (cross-ref against `.progress-{slug}.json`)
- Recommendation: invoke `/discover-confidence {slug}` next

## Halt-loop invariants

- The skill SHALL NOT modify the discovery plan during execute (use `/discover-improve` for blueprint refinement).
- The skill SHALL NOT touch any file inside `.claude/knowledge-base/references/` (boundary-check hook enforces).
- The skill SHALL NOT run `npm install`, `pip install`, `poetry install`, or any dependency installer inside `.claude/knowledge-base/references/`.
- The skill SHALL NOT emit `<promise>BLUEPRINT_COMPLETE</promise>` while ANY of the four halt-condition checks fails.
- The loop SHALL NOT iterate beyond `--max-iterations` or `--time-budget`.
- If exhausted before completion, the skill SHALL emit a promise with HONEST blocked-questions report.

## Per-iteration prompt skeleton (informational — actual prompt lives in `prompts/execute-mode-prompt.md`)

```
You are mid-discovery, iteration {N}/{MAX}.

Plan: {PLAN_PATH}
Blueprint (in progress): {BLUEPRINT_PATH}
Progress so far: {N answered}/{TOTAL} questions; {M blocked}.

Your next action:
1. Read `.claude/knowledge-base/discoveries/.progress-{slug}.json` to know which questions remain.
2. Pick the next unanswered question with the lowest dependency depth.
3. Apply the planned method.
4. Append the answer to {BLUEPRINT_PATH} under the question's mapped section, with citations.
5. Update `.progress-{slug}.json`.
6. If all halt conditions hold, emit <promise>BLUEPRINT_COMPLETE</promise>. Otherwise, STOP — the loop will resume.
```

## What this skill does NOT do

- Generate the discovery plan — that's `/discover-plan`.
- Review edge cases — that's `/discover-edge-cases`.
- Score the blueprint — that's `/discover-confidence`.
- Refine a low-scoring blueprint — that's `/discover-improve`.
- Modify `.claude/knowledge-base/references/` — forbidden by boundary-check hook.

## Related

- Upstream skill: `/discover-plan` (produces the plan this skill consumes)
- Upstream skill: `/discover-edge-cases` (validates the plan before execute)
- Downstream skill: `/discover-confidence` (scores the blueprint this skill produces)
- Downstream skill: `/discover-improve` (refines the blueprint if confidence is low)
- Template: `templates/blueprint-template.md`
- Prompt: `prompts/execute-mode-prompt.md`
- Loop engine: `ralph-loop` plugin (must be enabled in `~/.claude/settings.json`)
