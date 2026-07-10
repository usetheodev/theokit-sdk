---
"@theokit/sdk": minor
---

**SE23 — `defineSkillReadTool` (opt-in model-facing lazy skill read).**

`defineSkillReadTool(skills)` returns a `skill_read` `CustomTool` the consumer explicitly adds to `AgentOptions.tools`. When the model calls it with a skill name, the handler returns that skill's `instructions` (+ SE21 `references`); an unknown-but-well-formed name returns a typed "not found" string listing the available skills — NOT a throw that kills the run (Rule 8). Malformed input (missing `name`) fails at the trust boundary via the input schema.

The SDK never auto-injects it — bring-your-own-tools stays intact (sibling of `defineSubAgent` / `workflowAsTool`). This is the LAZY read path that complements the eager `<skills>` block (name + description only): the block discloses which skills exist; `skill_read` loads a body on demand. The consumer controls exposure by choosing which skills to pass. See ADR 0007. Mirrors Mastra's `skill_read` — but opt-in, not auto-injected. From the Mastra Agent-skills comparison (SDK Evolution roadmap SE23).
