# Cycle: DISCOVER

Source of Truth for the discovery cycle. Skills consume this; do not duplicate content into SKILL.md.

## Purpose

Investigate **how others solved a problem** before writing code. Outputs a blueprint of patterns, trade-offs, and references — never code.

## Pre-conditions

- "How does <project X> handle <Y>?"
- "What does the field do for <problem Z>?"
- A planning task is blocked because nobody on the team knows the prior art.

Do NOT trigger DISCOVER for:
- Locating a symbol in your own code (use Grep/Glob).
- Questions answered by reading your own `README.md` / `ARCHITECTURE.md`.

## Chain (unbreakable)

```
/discover-plan {topic-slug}
     ↓ (produces: knowledge-base/discoveries/plans/{slug}-plan.md)
/discover-edge-cases {topic-slug}
     ↓ (absorbs MUST-FIX into the plan)
/discover-plan-confidence {topic-slug}
     ↓ (plan-gate: structural score of the discovery plan itself; INVALID returns to /discover-plan)
/discover-execute {topic-slug}
     ↓ (produces: knowledge-base/discoveries/blueprints/{slug}-blueprint.md)
/discover-confidence {topic-slug}
     ↓ (blueprint score; if ≥ SHIPPABLE_WITH_CAVEATS, optional skill promotion follows)
/discover-improve {topic-slug}  [optional — only if blueprint score is NEEDS_REVISION]
     ↓
/skill-writer {topic-slug}      [optional — promotes blueprint to a *-patterns skill]
/skill-validator {topic-slug}   [optional]
/skill-register {topic-slug}    [optional]
```

## Phase contracts

| Phase | Input | Output | Hard gate |
|---|---|---|---|
| plan | topic slug + 1-sentence question | discovery plan with sources, questions, deliverables | sources cited and reachable |
| edge-cases | discovery plan | annotated plan with MUST-FIX items | every MUST-FIX has a citation or open question |
| plan-confidence | annotated plan | score + verdict on the plan itself | no fabricated citation; coverage corners non-empty; question budget respected |
| execute | annotated + scored plan | blueprint (patterns, trade-offs, references) | no fabricated citations |
| confidence | blueprint | score + verdict (INVALID / NEEDS_REVISION / SHIPPABLE_WITH_CAVEATS / SHIPPABLE) | INVALID returns to plan |
| improve (opt.) | NEEDS_REVISION blueprint | revised blueprint | bumped verdict on re-score |
| writer/validator/register (opt.) | SHIPPABLE blueprint | first-class `*-patterns` skill in `skills/` | passes skill-validator gates |

## Stop conditions

- Verdict INVALID → return to `/discover-plan` (rewrite the question).
- 3 consecutive iterations without confidence improvement → escalate to a human.

## Anti-patterns

- Discovery that turns into implementation. The output is a document, not code.
- Fabricated citations (URLs that 404, projects that don't exist). The hook does not catch this — review does.
- Stopping at one source. A blueprint needs ≥ 2 independent references.
- Skipping `/discover-edge-cases` to move faster. Edge cases caught here are 100× cheaper than caught post-implementation.

## Rollback

A registered skill that turns out wrong can be demoted:

```
mv skills/{name}/ skills/generated/{name}/
```

`/to-plan`'s Step 0 stops discovering it; the audit in `knowledge-base/reviews/skill-register-*.md` stays for the record.

## Cross-references

- Schema for cycle rules: `rules/cycle-rule-schema.md`
- Skills: `skills/discover-plan/SKILL.md`, `skills/discover-edge-cases/SKILL.md`, `skills/discover-plan-confidence/SKILL.md`, `skills/discover-execute/SKILL.md`, `skills/discover-confidence/SKILL.md`, `skills/discover-improve/SKILL.md`, `skills/skill-writer/SKILL.md`, `skills/skill-validator/SKILL.md`, `skills/skill-register/SKILL.md`
- Allowlist: `rules/discover-web-allowlist.txt`
- Downstream: `rules/cycle-plan.md` (consumes blueprints as input to `/to-plan`)
