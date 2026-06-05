# Cycle: AUTO-PLAN (super-cycle orchestrator)

Source of Truth for the end-to-end autonomous orchestrator.

## Purpose

Chain DISCOVER → PLAN → IMPLEMENT → CODE-QUALITY → REVIEW → RELEASE autonomously, taking a topic from idea to a release PR awaiting human approval — without the user having to invoke 9+ slash commands manually. Default mode is `full-pipeline`; the `--plan-only` flag retains the legacy "discover + plan" behavior.

## Pre-conditions

- The topic is large enough that running cycles manually would be tedious.
- The user explicitly authorizes autonomous execution.

When NOT to use:
- A plan already exists AND only implementation remains → call `/implement` directly.
- The feature is trivial (< 1 hour by hand).
- You're not 95% sure about requirements (Unbreakable Rule 1).

## Chain

Default (`/auto-plan {topic-slug}`):

```
/auto-plan {topic-slug}
     ↓ DISCOVER     (full chain, if no prior blueprint)
     ↓ PLAN         (full chain — auto-injects MUST-FIX from edge-case-plan into the plan)
     ↓ gate:         only proceed if /plan-confidence ≥ SHIPPABLE_WITH_CAVEATS
     ↓ IMPLEMENT    (halt-loop until IMPLEMENTATION_COMPLETE)
     ↓ CODE-QUALITY (audit; gate proceeds only when PASS / PASS_WITH_CAVEATS)
     ↓ REVIEW       (5-7 specialist agents)
     ↓ gate:         only proceed if /review = READY_TO_MERGE
     ↓ RELEASE      (opens develop→main PR with semver tag; PAUSES for human approval)
     ↓ verdict:      RELEASED OR PR_OPEN_AWAITING_APPROVAL
```

`--plan-only` mode:

```
/auto-plan {topic-slug} --plan-only
     ↓ DISCOVER
     ↓ PLAN
     ↓ stops at the locked plan; user invokes /implement manually later
```

## Confidence gates between phases

- Before PLAN starts: discovery blueprint exists OR user explicitly confirms no prior art needed (deterministic; pre-recorded via `--no-discover`).
- Before IMPLEMENT starts: plan-confidence verdict ≥ SHIPPABLE_WITH_CAVEATS.
- Before CODE-QUALITY starts: implementation emitted `IMPLEMENTATION_COMPLETE`.
- Before REVIEW starts: code-quality verdict ∈ {`PASS`, `PASS_WITH_CAVEATS`}.
- Before RELEASE starts: review verdict = `READY_TO_MERGE`.
- Final manual gate: human approves the release PR. Auto-merge is forbidden (Unbreakable Rule 4).

Any gate failure → pause + surface the blocking finding. The orchestrator does NOT loop indefinitely; after 1 fix-and-retry attempt at the same gate, it halts with `BLOCKED` and asks the human.

## Stop conditions

- Any cycle's stop condition fires.
- A hard gate failure that the orchestrator cannot resolve autonomously (e.g., merge conflict, missing credential).

## Anti-patterns

- Running `/auto-plan` on a topic with unclear requirements. Garbage in, garbage out.
- Ignoring the confidence gates ("just proceed anyway"). The gates exist to catch divergence early.
- Mixing manual and auto-plan invocations on the same slug — they share state and will conflict.

## When manual cycles are preferred

For most features, running cycles manually with human review between them produces better output than autonomous chaining. Reserve `/auto-plan` for topics where the orchestration overhead actually pays for itself.

## Cross-references

- Schema for cycle rules: `rules/cycle-rule-schema.md`
- Orchestrator skill: `skills/auto-plan/SKILL.md`
- Chained cycles: `rules/cycle-discover.md`, `rules/cycle-plan.md`, `rules/cycle-implement.md`, `rules/cycle-code-quality.md`, `rules/cycle-review.md`, `rules/cycle-release.md`
- Conventions: `rules/loop-engine-convention.md`
