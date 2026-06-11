# Stash drop audit — 2026-06-02

## What was stashed

```
stash@{0}: On develop: pre-implement: 48 unrelated changes parked for sdk-subpath-extraction-workflow-eval
```

Real contents (verified via `git stash show stash@{0} --stat`):

```
.claude/skills/dogfood/.gitignore      |   1 -
.claude/skills/dogfood/SKILL.md        | 175 --------
.claude/skills/dogfood/lib/cdp.mjs     | 132 ------
.claude/skills/dogfood/lib/dogfood.mjs | 781 ---------------------------------
.claude/skills/dogfood/setup.sh        |  38 --
5 files changed, 1127 deletions(-)
```

The stash message overstates scope ("48 unrelated changes") — actual stash is a pure 5-file deletion of the legacy `dogfood` skill that targeted `examples/telegram-pro` via Chrome DevTools Protocol.

## Why drop instead of apply

The legacy `dogfood` skill is **still wired**:

- `examples/telegram-pro/` exists and the skill targets its command surface (25 commands tested per smoke run).
- `.claude/skills/to-plan/SKILL.md:152` references `/dogfood full` as the mandatory QA gate for every plan.
- Plan files under `.claude/knowledge-base/plans/` cite `/dogfood` as the dogfood entry-point.
- Memory entries like `[[telegram-pro-feature-port-shipped]]` reference `dogfood QA 38/38` runs from this skill.

Deleting it would break the telegram-pro testing flow without a replacement (`/dogfood-app` and `/dogfood-stranger` test the **meta-repo** ecosystem, not the SDK's telegram-pro example).

The deletion was parked when work shifted to the sub-paths extraction (Workflow + Eval). It was never committed because the rationale (replacement skill) never landed.

## Decision

**Drop the stash.** Keep the legacy `dogfood` skill in `theokit-sdk/.claude/skills/dogfood/`. If a future iteration migrates telegram-pro to the new `/dogfood-app` shape, that work needs its own plan + replacement skill before the deletion can land.

## Action taken

```bash
git stash drop stash@{0}
```

Worktree files at `.claude/skills/dogfood/{.gitignore,SKILL.md,setup.sh,lib/cdp.mjs,lib/dogfood.mjs}` remain unchanged (the stash never modified them — it was only an INTENT to delete that never executed).
