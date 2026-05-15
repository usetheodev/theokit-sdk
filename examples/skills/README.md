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

## Behaviour

Loaded skills are auto-injected into the LLM system prompt as a
`<skills>` block listing each skill's `name: description` (ADR D4).
The skill body never leaves the loader — only the frontmatter fields
are exposed. Descriptions are XML-escaped before embedding (ADR D9).

Opt out with `skills: { autoInject: false }` when you want full control
through a custom `systemPrompt` resolver. The resolver still receives
the skills metadata via `ctx.skills`.

> v1 limitation (EC-7): the SDK does not impose a cross-provider
> system-prompt token budget. Keep loaded-skill counts modest. A future
> minor release may add a pipeline-level budget allocation.
