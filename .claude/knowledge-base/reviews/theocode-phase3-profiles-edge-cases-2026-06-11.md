# Edge Case Review — theocode-phase3-profiles

Date: 2026-06-11
Tasks analyzed: 6 (T3.1-T3.6)
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: Skill loader reads arbitrary files if .theocode/skills/ contains symlinks
- **Affected task:** T3.4
- **Family:** Security / Permission
- **Scenario:** `.theocode/skills/evil.md` is a symlink to `/etc/passwd`. `createSkillTool` loads the content via `fs.readFile`. The plan mentions "path traversal rejection" for `../` but does NOT mention symlink escape.
- **Impact:** Information disclosure — agent reads arbitrary files outside the skills directory.
- **Suggested fix:** Add `assertNoSymlinkEscape` check (same as sdk-tools' `pathScopeCheck`) on the resolved skill path before reading. One line: `if (lstatSync(fullPath).isSymbolicLink()) return JSON.stringify({ ok: false, error: "symlink_forbidden" });`

## SHOULD TEST

### EC-2: Profile selector with model ID that has no provider prefix
- **Affected task:** T3.1
- **Suggested test:** `test_selector_bare_model_id()` — `resolveProfile("claude-sonnet-4")` (no `anthropic/` prefix) should still resolve to anthropic profile by matching the model name pattern. If not matchable, fall back to default. This is realistic because `Agent.create({ model: { id: "claude-sonnet-4" } })` is valid.

### EC-3: Truncation with exactly the limit size
- **Affected task:** T3.5
- **Suggested test:** `test_truncate_at_exact_limit_not_truncated()` — output exactly 30KB (= limit) should NOT be truncated (boundary: `>=` vs `>`). Verify the threshold is strict-greater-than, not greater-or-equal.

## DOCUMENT

### EC-4: Plan mode state not persisted across process restarts
- **Accepted risk:** `createPlanModeTool` stores mode in memory (a variable). If the process restarts, mode resets to "normal". This is acceptable for v1 because: (a) sessions persist but mode is ephemeral, (b) OpenCode also doesn't persist plan mode across restarts, (c) adding persistence would require a session metadata column — deferred to Phase 4.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T3.1 | 1 | 0 | 1 (EC-2) | 0 |
| T3.2 | 0 | 0 | 0 | 0 |
| T3.3 | 1 | 0 | 0 | 1 (EC-4) |
| T3.4 | 1 | 1 (EC-1) | 0 | 0 |
| T3.5 | 1 | 0 | 1 (EC-3) | 0 |
| T3.6 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 1 MUST FIX: symlink escape guard on skill loader.
