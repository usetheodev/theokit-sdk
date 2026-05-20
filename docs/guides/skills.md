# Skills

Skills are named capability packs. They give the agent focused instructions and affordances without expanding the stable SDK surface for every capability.

## File-Based Skills

Local file-based skills live at `.theokit/skills/<name>/SKILL.md` and are loaded when `local.settingSources` includes `"project"`. Cloud agents load skills committed in the repo.

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd(), settingSources: ["project"] },
  skills: {
    enabled: ["code-review", "test-architect"],
  },
});

const skills = await agent.skills.list();
```

Example `SKILL.md`:

```markdown
---
name: code-review
description: Reviews TypeScript SDK changes for contract regressions.
---

Check public API compatibility, runtime behavior, and tests that can produce false positives.
```

## Public API

```typescript
interface SkillsOptions {
  enabled?: string[];
  paths?: string[];
}

interface SDKSkillsManager {
  list(): Promise<Array<{ name: string; description: string }>>;
}
```

`agent.skills.list()` returns public metadata only. Full prompt bodies are not stable public output and must not appear in stream events, snapshots, logs, or errors.

## Reloading And Validation

Call `agent.reload()` after adding or editing a skill. Reload preserves conversation state and re-reads skills, context, hooks, project MCP, and subagents.

Malformed frontmatter, missing `name`, or missing `description` raises `ConfigurationError`. Invalid skills are not silently ignored.

## Runtime Rules

Inline options can select which skills are enabled, but durable file-based skills should be committed to the repo. Cloud rejects local-only skill paths unless those files are present in the cloned repository.
