---
"@theokit/sdk": minor
---

A project set up for the Claude Code CLI now works without being converted: `.claude/agents`,
`.claude/skills`, `.claude/hooks.json` and the CLI's own `settings.json` / `settings.local.json` are
read alongside `.theokit`.

The formats already agreed — only the directory did not. Measured 2026-08-26: `SkillFrontmatter`
requires exactly the `name` and `description` the CLI writes into every `SKILL.md`; the hook config
this SDK parses is documented as, and is, the CLI's `settings.json` hooks shape; and 59 of the CLI's
agent declarations parse here unchanged.

`.theokit` is searched first and nothing about it changes. Two rules, and the difference between
them is deliberate:

- **Named declarations collide, so the first wins.** Two files declaring an agent or a skill called
  `foo` are one name claimed twice, and the explicit namespace should win.
- **Hooks accumulate.** They are unnamed lists — two files declaring `PreToolUse` are two sets of
  commands an operator wrote, and keeping one would drop the other in silence.

`THEOKIT_HOME` deliberately does not move these directories. It relocates cwd-anchored SDK *state*;
a project's *configuration* belongs to the repository, and following the override here would change
where a project's agents come from under the cover of a refactor.

Known limitation: `SessionStart` and `PreCompact` have no firing point in this runtime, so hooks
declared for them are skipped with a warn rather than silently accepted. Four CLI events map:
`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`.
