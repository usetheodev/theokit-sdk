---
"@theokit/sdk": minor
---

**SE20 — `agent.skills.get(name)` (read a skill's full body).**

`agent.skills.list()` already returned skill metadata (name + description only); SE20 adds `agent.skills.get(name)` returning the skill INCLUDING its `instructions` (body) — read from the inline `createSkill` body, or from the filesystem SKILL.md (frontmatter stripped) for discovered skills. Returns `undefined` when no enabled skill matches (malformed skills stay excluded). New public type `SDKAgentSkillDetail`.

`list()` stays lean (the `<skills>` block only ever carries name + description); full bodies come only through `get`. Mirrors Mastra's `agent.getSkill(name)`. Additive + backward-compatible. From the Mastra Agent-skills comparison (SDK Evolution roadmap SE20).
