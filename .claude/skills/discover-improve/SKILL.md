---
name: discover-improve
description: Iteratively improve a blueprint's discover-confidence score by applying deterministic fixes + LLM-driven semantic fixes via a halt-loop (ralph-loop-style autonomous iteration). Mirrors /plan-improve but for blueprints.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit Skill
argument-hint: "{blueprint-slug} [--target SHIPPABLE_WITH_CAVEATS] [--max-iterations 20]"
---

# Discover-Improve — Iterative Blueprint Score Lifter

Reads a blueprint, scores it with `/discover-confidence`, applies deterministic + semantic fixes, re-scores, and repeats until the blueprint reaches the target verdict.

Sibling of `/plan-improve` — same architecture (ralph-loop halt-loop + deterministic Phase A + LLM Phase B), different fix categories tailored to **blueprints** (not implementation plans).

**Architecture:** wraps the `ralph-loop` plugin's autonomous-iteration mechanism with a blueprint-specific prompt template.

**ADR reference:** see `.claude/skills/discover-confidence/SKILL.md` for the scoring contract.

## Cycle contract

This skill is **phase 5** of [`cycle-discover`](../../rules/cycle-discover.md). The cycle rule is the source of truth for chain order (invoked when `/discover-confidence` verdict < SHIPPABLE_WITH_CAVEATS; followed by `/discover-confidence` re-score; if verdict reaches SHIPPABLE_WITH_CAVEATS, skill-distillation tail begins), hard limits, anti-patterns, and rollback. **Read `cycle-discover.md` before invoking this skill.** This SKILL.md retains phase-specific detail (Phase A deterministic fixes for blueprints, Phase B LLM fixes, fix categories tailored to blueprint shape).

## When to Trigger

User explicitly invokes `/discover-improve {slug}` after seeing a low score from `/discover-confidence` and wanting the system to attempt auto-improvement.

## Workflow

### Step 1 — Argument parsing

Accept:

- `/discover-improve {slug}`
- `/discover-improve {slug} --target SHIPPABLE`
- `/discover-improve {slug} --max-iterations 30`

Where `{slug}` is the basename of a blueprint file in `.claude/knowledge-base/discoveries/blueprints/`.

Defaults:

- `--target`: `SHIPPABLE_WITH_CAVEATS` (the realistic ceiling for auto-improvement)
- `--max-iterations`: `20`

### Step 2 — Resolve blueprint path

Resolve to `.claude/knowledge-base/discoveries/blueprints/{slug}-blueprint.md`.

### Step 3 — Build the improvement prompt

Read `.claude/skills/discover-improve/prompts/improvement-prompt.md` and substitute:

- `{BLUEPRINT_SLUG}` — the slug
- `{BLUEPRINT_PATH}` — the resolved path
- `{TARGET_VERDICT}` — target band
- `{MAX_ITERATIONS}` — iteration limit

### Step 4 — Invoke ralph-loop (shell-safe positional + flags)

**Read `.claude/rules/loop-engine-convention.md § How to invoke ralph-loop:ralph-loop safely` BEFORE this step.** The ralph-loop positional argument is shell-evaluated; inlining a multi-section driver prompt (backticks / fenced code blocks / `$(...)`) breaks loop startup with a bash parse error. Use the file-referenced pattern.

1. Write the substituted prompt from Step 3 to `.claude/halt-loop-prompts/discover-improve-{blueprint-slug}.md` (gitignored).
2. Invoke `ralph-loop:ralph-loop` with:
   - Positional prompt (no shell metachars): `Read .claude/halt-loop-prompts/discover-improve-{blueprint-slug}.md and follow its instructions for this halt-loop iteration.`
   - `--completion-promise 'BLUEPRINT_IMPROVED'`
   - `--max-iterations N`

The ralph-loop plugin:

- Writes `.claude/ralph-loop.local.md` (state file)
- Activates the Stop hook
- Feeds the positional prompt back to Claude on each session-exit attempt (Claude re-reads the driver file each iteration)
- Detects `<promise>BLUEPRINT_IMPROVED</promise>` to terminate

### Step 5 — Report

After the loop terminates:

- Initial verdict vs final verdict
- Total changes per category
- Remaining issues that required human review
- Diff of all modifications (`git diff` against working tree)

## Fix categories (4 active in v1)

| Fix | Phase | Mechanism | Risk |
|---|---|---|---|
| Weak imperatives in blueprint prose (should/could/may/might) → must | A — deterministic | regex (skips code blocks + citation tables) | Low |
| Loopholes (if possible, when applicable, ...) | A — deterministic | regex | Low |
| Fabricated citation → mark as `<!-- BLOCKED: path not found in .claude/knowledge-base/references/ -->` | A — deterministic | path existence check | Low |
| Empty coverage corner → mark as `<!-- BLOCKED: corner X has zero content; re-run /discover-execute -->` | A — deterministic | section emptiness check | Low |

**Empty coverage corner is NOT auto-resolved via ADR.** A blueprint missing an entire coverage corner is a structural defect (hard cap 49 INVALID per `discover-blueprint-golden-rule.md`). Auto-laundering it through a Phase B ADR would let `discover-improve` paper over deep-research failure. Instead, Phase A marks the corner explicitly as BLOCKED — the human re-executes that section via `/discover-execute` (or revises the discovery plan).

**Phase A (apply_fixes.py)** runs first. **Phase B (LLM)** runs only if Phase A doesn't reach target.

## Invariants

- The skill SHALL NOT touch files outside `{BLUEPRINT_PATH}` (or the progress file).
- The skill SHALL NOT modify `.claude/knowledge-base/references/` (boundary-check hook enforces).
- The skill SHALL NOT modify the upstream discovery plan (use `/discover-plan` to revise the plan).
- The skill SHALL NOT commit or push to git.
- The skill SHALL NOT emit `<promise>BLUEPRINT_IMPROVED</promise>` falsely.
- The loop SHALL NOT iterate beyond `--max-iterations`.

## Hard limits

- `apply_fixes.py` is DETERMINISTIC — same input always produces same output. Idempotent. Cost: $0.
- Phase B LLM iterations use the main model.
- Maximum reasonable `--max-iterations`: ~30. Beyond that, the blueprint is probably structurally broken and needs human re-execute via `/discover-execute`.

## Output

When the loop completes:

```
=== Discover-Improve complete ===
Blueprint: <slug>
Initial verdict: NON_SHIPPABLE (52.0)
Final verdict:   SHIPPABLE_WITH_CAVEATS (74.5)
Iterations:      6 / 20

Changes applied:
  weak_imperatives: 14
  loopholes: 3
  fabricated_citations_marked: 2
  empty_corners_resolved_via_adr: 1

Remaining issues (need human):
  - Q5 — Project B citation `project-b/services/memory.py:142` does not exist; mark as BLOCKED but no replacement found.
  - Coverage Matrix row 8 — unmapped gap, marked TODO (loop could not justify deferral).

Diff: <git diff against working tree>
```

## Related

- Scorer: `.claude/skills/discover-confidence/SKILL.md`
- Loop engine: `ralph-loop` plugin (must be enabled in `~/.claude/settings.json`)
- Fix script: `.claude/skills/discover-improve/scripts/apply_fixes.py`
- Prompt template: `.claude/skills/discover-improve/prompts/improvement-prompt.md`
- Sibling skill: `/plan-improve` (same mechanism, applies to implementation plans)

## Limitations (honest)

- **Phase A fixes can over-correct.** Replacing "should" with "must" in a blueprint where "should" is a hedge ("the codebase should be < 50KB") may sound stronger than the evidence warrants. Acceptable trade-off because the rubric penalizes weak imperatives.
- **Phase B (empty-corner deferral) depends on LLM judgment.** The loop instructs Claude to leave TODO comments rather than fabricate, but the line between "credible ADR for deferral" and "fabricated rationale" is judgment-call.
- **Fabricated citations cannot be auto-fixed.** The fix is to MARK them as blocked, not to invent a correct path. Human must re-execute that section of the discovery.
- **Loop terminates** when EITHER target reached OR max-iterations OR no improvement seen in 2 consecutive iterations.
