# Skills (file-based loader)

Loads `.theokit/skills/<name>/SKILL.md` per skill — frontmatter
(`name` + `description`) becomes public metadata via
`agent.skills.list()`. The body of each skill stays internal.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. Writes two skills under `workspace/.theokit/skills/`:
   - `code-review/SKILL.md`
   - `doc-writer/SKILL.md`
2. Creates an agent with `local.settingSources: ["project"]` so the
   loader runs.
3. Lists skills via the public API (`agent.skills.list()`).
4. Asks the LLM to list them.

## ⚠️ Implementation status

Skills load and the public API (`agent.skills.list()`) returns them
correctly. The metadata is also passed into `SystemPromptContext.skills`
so a resolver can reference them. However, skills are NOT yet
auto-injected into the LLM's system prompt when no resolver is
configured — today the model has no awareness of the loaded skills
unless the caller threads them via `systemPrompt: (ctx) => ...`.

To get the agent in this example to "see" the skills today, set:

```ts
systemPrompt: (ctx) =>
  `Available skills:\n${ctx.skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")}`
```

Tracking: decide whether the agent loop should auto-prefix a skills
section to the system prompt or leave it explicit (current state).
