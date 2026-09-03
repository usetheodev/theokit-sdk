---
"@theokit/sdk": minor
---

A skill, subagent or plugin now says which directory it was read from.

usetheokit/theokit-sdk#524 asks for it in one line — *"whatever is imported should be reportable […]
silent inheritance is what made this take a debugging session to notice"* — and a consumer listing
its own skills could not tell that one had arrived from `.claude/skills/` rather than the project's
own directory.

What is new is not the data. It existed on all three and did not reach the caller:

- `Skill.source` was already the absolute path to the `SKILL.md`, and the projection that builds
  `agent.skills` mapped it away along with the body. The projection is right to drop the BODY —
  that is what `get()` is for — and dropping the PATH with it answered a question nobody asked.
- `agent.plugins.list()` has always returned `source` at runtime; the internal type's own docblock
  says it carries provenance "so callers can audit where the plugin came from". `SDKPluginMetadata`
  simply never declared it, so the caller received the field and the compiler denied it existed.
- `readSubagentsFrom` computes the file path on the line it reads the file, then dropped it.
  `AgentDefinition.source` keeps it.

`source` is optional on all three, and absence means something specific: declared in code, not read
from disk. A subagent passed through `AgentOptions.subagents` has no file and `source` is absent.
An inline `createSkill` skill has no file either, but already carried the synthetic `inline://<name>`
marker before this change (`create-skill.ts`) — so a skill's `source` is now populated for every
entry `list()` returns, either a disk path or that marker, and a first version of this fix wrongly
described it as absent for that case. An existing regression test (`agent-skills-get.test.ts`,
SE21) asserted `list()` must NOT carry `source` at all; it predates #524 and is updated here to
assert the marker instead, while still proving the skill's body and references never leak.

`SkillsHandle.list` is now typed as the public `SystemPromptSkillRef` instead of restating
`{ name; description }` inline. The two had drifted, and an internal handle declaring a narrower
shape than the contract it serves silently deletes fields the projection produces — which is exactly
how `source` reached the caller at runtime while not existing to the compiler.

Closes the visibility half of #524. The declarative `.theokit/config.toml` form is not in this
change.
