---
"@theokit/sdk": minor
---

M4-1 — first-party skill discovery + `<skills>` block (plan `m4-skills-discovery`).

New `@theokit/sdk/skills` subpath exposing two pure first-party primitives the SDK runtime already uses internally:

- `discoverSkills(dir, options?)` — discover `<dir>/<name>/SKILL.md` files under an ARBITRARY directory (not a hardcoded `.theokit/skills` root), parsing strict YAML frontmatter (`name`/`description` required; `category`/`dependencies` optional) and returning `Skill[]` (the skill BODY is never included). A subdirectory whose realpath escapes `dir` via symlink is skipped (symlink-escape guard, reusing `@theokit/sdk/path-safety`). NEVER throws — a missing/unreadable/non-directory path yields `[]`. A `SKILL.md` with malformed frontmatter is excluded and optionally reported via `options.onInvalidSkill`; a directory WITHOUT a `SKILL.md` is silently skipped.
- `buildSkillsBlock(skills)` — render the prompt-injection-safe `<skills>` system-prompt block (name + description XML-escaped); returns `undefined` for an empty list.

The internal `SkillsManager` (`.theokit/skills` discovery) and `SkillsPromptProvider` (`<skills>` injection) now delegate to these primitives — single source of truth, behavior preserved (golden + contract tests unchanged). Zero new dependencies.
