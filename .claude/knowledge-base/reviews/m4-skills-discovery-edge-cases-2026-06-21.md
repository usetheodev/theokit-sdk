# Edge Case Review — m4-skills-discovery

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m4-skills-discovery-plan.md
Tasks analyzed: 4 (T1.1 buildSkillsBlock, T1.2 discoverSkills, T2.1 wiring, T2.2 wiring test)
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 1)

## Boundary map

`discoverSkills(dir)` is the only live boundary: an fs reader with a never-throw contract over an arbitrary directory. `buildSkillsBlock` is a pure string transform (no I/O). The plan already folds the high-risk fs edges into T1.2 TDD (malformed-skip, missing-dir→[], symlink-escape). The residual edges are fs-shape variants and output ordering. No network, no mutation, no concurrency (discovery is a one-shot read; `SkillsManager.refresh()` already serializes).

## MUST FIX

(none — never-throw is ADR D10/EC-5 + reuse of `readWorkspaceDir` (returns `[]` on read error); symlink guard reuses M0-4 `assertNoSymlinkEscape`; injection escape is ADR D9 + golden test.)

## SHOULD TEST

### EC-1: `dir` is a file (or a non-directory entry), not a directory
- **Affected task:** T1.2
- **Family:** Input
- **Scenario:** a consumer passes a path that exists but is a regular file. `readWorkspaceDir` must yield `[]` (or the loop must tolerate it) rather than throwing, to honor the never-throw contract.
- **Suggested test:** `discoverSkills_on_file_path_returns_empty` — point `discoverSkills` at a file path → asserts `[]`, no throw.

### EC-2: subdirectory without a `SKILL.md` is silently skipped (not counted, not an error)
- **Affected task:** T1.2
- **Family:** Format
- **Scenario:** the skills root contains a `<name>/` dir with no `SKILL.md` (e.g. a stray dir). The `readFile` catch must skip it without firing `onInvalidSkill` (it is not a malformed skill — it is simply not a skill).
- **Suggested test:** `discoverSkills_skips_dir_without_skill_md` — a subdir with no SKILL.md → excluded from results AND `onInvalidSkill` NOT called.

## DOCUMENT

### EC-3: discovery order follows fs `readdir` order (not guaranteed stable across platforms)
- **Accepted risk:** `discoverSkills` returns skills in `readWorkspaceDir`/`readdir` iteration order, which is OS/filesystem-dependent. This matches the existing `SkillsManager` behavior (no regression). `buildSkillsBlock` renders in the order it receives, so the `<skills>` block order mirrors discovery order. The internal golden test feeds a fixed-order list from the manager, so it is unaffected. Consumers who need a stable block order should sort the `Skill[]` before calling `buildSkillsBlock`. No action — documenting the contract is enough (a one-line note in `docs.md` for the subpath suffices).

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 3 | 0 | EC-1, EC-2 | EC-3 |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (2 SHOULD TEST — file-path-input + skill-less-subdir — fold into T1.2 TDD; EC-3 is a one-line docs note; no MUST FIX)
