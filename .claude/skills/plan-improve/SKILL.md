---
name: plan-improve
description: Iteratively improve a /to-plan plan's M2 score by applying deterministic fixes + LLM-driven semantic fixes via a ralph-loop-style autonomous iteration. Use after /plan-confidence returns a verdict below SHIPPABLE_WITH_CAVEATS (NON_SHIPPABLE or INVALID) and you want the system to attempt auto-improvement before human intervention.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit Skill
argument-hint: "{plan-slug} [--target SHIPPABLE_WITH_CAVEATS] [--max-iterations 20]"
---

# Plan-Improve — Iterative Score Lifter

Reads a plan, scores it with `/plan-confidence`, applies deterministic + semantic fixes, re-scores, and repeats until the plan reaches the target verdict.

**Architecture:** wraps the `ralph-loop` plugin's autonomous-iteration mechanism (Stop hook + state file) with a domain-specific prompt template.

**ADR reference:** see `.claude/skills/plan-confidence/SKILL.md` for the scoring contract.

## Cycle contract

This skill is **phase 4** of [`cycle-plan`](../../rules/cycle-plan.md). The cycle rule is the source of truth for chain order (invoked when `/plan-confidence` verdict < SHIPPABLE_WITH_CAVEATS; followed by `/plan-confidence` re-score), hard limits (max-iterations, no-improvement detection), anti-patterns (never fabricate ADR alternatives), and rollback. **Read `cycle-plan.md` before invoking this skill.** This SKILL.md retains phase-specific detail (Phase A deterministic fixes, Phase B LLM fixes, fix categories, limitations).

## When to Trigger

User explicitly invokes `/plan-improve {slug}` after seeing a low score from `/plan-confidence` and wanting the system to attempt auto-improvement.

## Workflow

### Step 1 — Argument parsing

Accept these forms:
- `/plan-improve {slug}`
- `/plan-improve {slug} --target SHIPPABLE`
- `/plan-improve {slug} --max-iterations 30`

Where `{slug}` is the basename of a plan file in `.claude/knowledge-base/plans/` (or auto-detected plans directory).

Defaults:
- `--target`: `SHIPPABLE_WITH_CAVEATS` (the realistic ceiling per ADR D8 + EC-5)
- `--max-iterations`: `20`

### Step 2 — Resolve plan path

If the argument is a slug, resolve to `.claude/knowledge-base/plans/{slug}-plan.md`. Fall back to `.claude/knowledge-base/plans/completed/{slug}-plan.md` if the active dir doesn't have it.

### Step 3 — Build the improvement prompt

Read `.claude/skills/plan-improve/prompts/improvement-prompt.md` and substitute:
- `{PLAN_SLUG}` — the slug
- `{PLAN_PATH}` — the resolved path
- `{TARGET_VERDICT}` — target band
- `{MAX_ITERATIONS}` — iteration limit

### Step 4 — Invoke ralph-loop (shell-safe positional + flags)

**Read `.claude/rules/loop-engine-convention.md § How to invoke ralph-loop:ralph-loop safely` BEFORE this step.** The ralph-loop positional argument is shell-evaluated; inlining a multi-section driver prompt (backticks / fenced code blocks / `$(...)`) breaks loop startup with a bash parse error. Use the file-referenced pattern.

1. Write the substituted prompt from Step 3 to `.claude/halt-loop-prompts/plan-improve-{plan-slug}.md` (gitignored).
2. Invoke `ralph-loop:ralph-loop` with:
   - Positional prompt (no shell metachars): `Read .claude/halt-loop-prompts/plan-improve-{plan-slug}.md and follow its instructions for this halt-loop iteration.`
   - `--completion-promise 'PLAN_IMPROVED'`
   - `--max-iterations N`

The ralph-loop plugin:
- Writes `.claude/ralph-loop.local.md` (state file)
- Activates the Stop hook
- Feeds the positional prompt back to Claude on each session-exit attempt (Claude re-reads the driver file each iteration)
- Detects `<promise>PLAN_IMPROVED</promise>` to terminate

### Step 5 — Report

After the loop terminates (promise detected OR max iterations), print:
- Initial verdict vs final verdict
- Total changes per category (weak_imperatives, loopholes, tdd_template, adr_alternatives)
- Remaining issues that required human review (if any)
- Diff of all modifications (`git diff` against working tree)

## Fix categories (4 active in v1)

| Fix | Phase | Mechanism | Risk |
|---|---|---|---|
| Weak imperatives (should/could/may/might/deveria/poderia) | A — deterministic | regex (skips code blocks + task headers) | Low |
| Loopholes (if possible, when applicable, …) | A — deterministic | regex (skips code blocks) | Low |
| TDD template in bug-fix tasks | A — deterministic | template injection before #### Acceptance Criteria | Low |
| ADR alternatives | B — LLM | Claude reads ADR context, proposes plausible alternative, adds to Rationale; if not credible, leaves a TODO | Medium |

**Phase A (apply_fixes.py)** is invoked first via Bash. **Phase B (LLM)** runs only if Phase A doesn't reach target.

## Invariants

- The skill SHALL NOT touch files outside `{PLAN_PATH}`.
- The skill SHALL NOT commit or push to git.
- The skill SHALL NOT emit `<promise>PLAN_IMPROVED</promise>` falsely.
- The loop SHALL NOT iterate beyond `--max-iterations`.
- If the loop reaches max iterations without target met, the agent emits the promise WITH an honest "remaining issues" report.

## Hard limits

- `apply_fixes.py` is DETERMINISTIC — same input always produces same output. Idempotent: running twice = no second change. Cost: $0.
- Phase B LLM iterations use the main model (cost depends on plan size and number of ADRs to enrich).
- Maximum reasonable max-iterations: ~30. Beyond that, the plan is probably structurally broken and needs human intervention.

## Output

When the loop completes:

```
=== Plan-Improve complete ===
Plan: <slug>
Initial verdict: NON_SHIPPABLE (49.0)
Final verdict:   SHIPPABLE_WITH_CAVEATS (72.3)
Iterations:      8 / 20

Changes applied:
  weak_imperatives: 23
  loopholes: 7
  tdd_template: 2
  adr_alternatives: 4

Remaining issues (need human):
  - D5 — alternatives left as TODO comment (loop could not find credible alt)
  - Coverage Matrix row 8 — unmapped gap, marked TODO (loop could not justify deferral)

Diff: <git diff against working tree>
```

## Related

- Scorer: `.claude/skills/plan-confidence/SKILL.md`
- Loop engine: `ralph-loop` plugin (must be enabled in `~/.claude/settings.json`)
- Fix script: `.claude/skills/plan-improve/scripts/apply_fixes.py`
- Prompt template: `.claude/skills/plan-improve/prompts/improvement-prompt.md`

## Limitations (honest)

- **Phase A fixes can over-correct.** Replacing "should" with "must" everywhere may make some sentences sound forced ("must consider X" instead of "should consider X"). Acceptable trade-off because the rubric explicitly penalizes "should" as weak.
- **Phase B (ADR alternatives) depends on LLM judgment.** The loop instructs Claude to leave TODO comments rather than fabricate, but the line between "credible alternative" and "fabricated text" is judgment-call.
- **Unmapped Coverage Matrix gaps** require either (a) creating new tasks (Phase B doesn't do this — too risky) or (b) marking as deferred (only if a real ADR justifies it). Most unmapped gaps will require human intervention.
- **Loop terminates** when EITHER target reached OR max-iterations OR no improvement seen in 2 consecutive iterations.
