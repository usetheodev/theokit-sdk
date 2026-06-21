# Discover Edge Case Review — m3-command-policy

Date: 2026-06-21
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/m3-command-policy-plan.md
Research questions analyzed: 5
Edge cases found: 2 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX
(none — all cited paths verified; 4 corners mapped; compose-not-reimplement + deny-wins are explicit gates.)

## SHOULD TEST

### EC-1: empty policy list must allow everything (no policies = no denial)
- **Affected question:** Q4
- **Suggested halt-loop checkpoint:** before promising Q4 complete, assert the blueprint states `isCommandAllowed(cmd, [])` returns true and `commandDenialReason(cmd, [])` returns null (an empty policy array denies nothing — Array.every over [] is vacuously true). This is the boundary that a naive `find`/`some` could get wrong.

## DOCUMENT

### EC-2: a policy is a heuristic gate, not a sandbox (inherits M3-2's honesty)
- **Accepted risk:** `denyCatastrophicCommands()` is only as strong as `catastrophicShellReason` (bypassable by obfuscation, POSIX-only). The policy layer adds composition, not stronger guarantees. Documented (inherits ADR D5 of M3-2).

## Summary

| Question | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------|----------|-------------|----------|
| Q4 | 1 | 0 | EC-1 | 0 |
| Q5 | 1 | 0 | 0 | EC-2 |

**Verdict:** DISCOVERY PLAN OK (1 SHOULD TEST — empty-policy-list allows-all — elevated to a blueprint must-state; 1 DOCUMENT; no MUST FIX)
