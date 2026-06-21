# Discover Edge Case Review — m3-repo-map

Date: 2026-06-20
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/m3-repo-map-plan.md
Research questions analyzed: 5
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 2)

## MUST FIX

(none — every cited reference + in-repo path verified to exist; 4 corners mapped; the never-throw + fs-only contract is the explicit anti-pattern guard in ADR D1.)

## SHOULD TEST

### EC-1: never-throw contract must survive a missing / unreadable cwd
- **Affected question:** Q5
- **Suggested halt-loop checkpoint:** before promising Q5 complete, assert the blueprint specifies that `buildEnvContext`/`buildRepoMap` wrap ALL fs access so a non-existent cwd, a permission-denied dir, or a symlink loop yields a best-effort partial string (or an empty `<repo_map/>`), never a thrown exception. (Already encoded as the Q5 never-throw gate; this elevates it to a blueprint must-state.)

## DOCUMENT

### EC-2: codex env-context carries permission/sandbox fields the SDK must NOT copy
- **Accepted risk:** `environment_context.rs` renders `<filesystem>`/`<permission_profile>` (managed/disabled/external) — that is codex's sandbox model, explicitly out of scope (ADR D2 + Out-of-Scope table). The blueprint takes only the portable fields (cwd, shell/platform, date, is-git). No action beyond honoring the scope line.

### EC-3: opencode `<env>` block pulls plugin/Reference "available_references" via Effect
- **Accepted risk:** `system.ts:75-95` appends `<available_references>` from a plugin Reference service — not portable (Effect runtime + plugin boot). The SDK mirrors only the plain `<env>` field block (`system.ts:67-72`), not the references machinery. Documented; the SDK's equivalent (AGENTS.md/README surfacing) comes from codex's `agents_md.rs` precedent instead.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 0 | 0 | 0 | 0 |
| Q2 | 0 | 0 | 0 | 0 |
| Q3 | 0 | 0 | 0 | 0 |
| Q4 | 1 | 0 | 0 | EC-2, EC-3 |
| Q5 | 1 | 0 | EC-1 | 0 |

**Verdict:** DISCOVERY PLAN OK (1 SHOULD TEST elevated to a blueprint must-state; 2 DOCUMENT scope-guards; no MUST FIX)
