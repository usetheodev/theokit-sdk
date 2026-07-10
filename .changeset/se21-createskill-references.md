---
"@theokit/sdk": minor
---

**SE21 — `references` on `createSkill` (bundle supporting docs on an inline skill).**

`createSkill({ ..., references })` now accepts an optional `references` map (filename → content), mirroring a filesystem skill's `references/` directory. The docs travel on the inline skill object and surface to the app via `agent.skills.get(name)` (new `references` field on `SDKAgentSkillDetail`); they are NOT injected into the model prompt. Omitted when not provided (backward-compatible). Mirrors Mastra Agent-skills `references`.

Also closes a latent boundary leak surfaced by this change: `agent.skills.list()` now projects to the public shape (name + description only), so an inline skill's `instructions` / `references` / `source` never leak through `list()` — the body is reachable exclusively through `get()`, matching the documented `SystemPromptSkillRef` contract. From the Mastra Agent-skills comparison (SDK Evolution roadmap SE21).
