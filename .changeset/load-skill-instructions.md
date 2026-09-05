---
"@theokit/sdk": minor
---

`loadSkillInstructions` — turn a discovered skill into an inline one without a second parser

`SkillsSettings.inline` requires `instructions`, and `discoverSkills` returns only the frontmatter
fields plus `source`. So a consumer wanting to feed discovered skills back in had one route: open
`source` and split the frontmatter by hand.

That is a second implementation of this module's own convention — the thing
`@theokit/sdk/subagents-loader` was published to end — and it fails **silently** if the format ever
moves: the frontmatter lands inside the instructions and nothing says so.

```ts
import { discoverSkills, loadSkillInstructions } from "@theokit/sdk/skills";

const skills = await discoverSkills(dir);
const inline = await Promise.all(
  skills.map(async (s) => ({ ...s, instructions: await loadSkillInstructions(s) })),
);
```

**`Skill` is unchanged**, deliberately. Its docblock says *"the skill BODY is never included"* — a
written contract whose reason is not written down, and the likely one (a catalog you can put in a
prompt without carrying every body) is worth keeping intact. The body was never expensive to
obtain: discovery already reads each file in full and discards all but the frontmatter. What was
missing was a door that hands it over, which is what this is — the same relationship
`loadSubagentDefinition` has to `discoverSubagents`.

It **throws** on an unreadable `source`, unlike discovery, which skips what it cannot read. A caller
naming one skill has asked about that skill, and an empty string would answer a question it did not
ask.

Reported by the `theocode` session, which needed an operator's `~/.theokit/skills/` to reach an
agent through this SDK's parser rather than a copy of it.
