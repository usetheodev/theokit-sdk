# File-based config

`.theokit/` files augment a **code-created** agent. The agent is still made with
`Agent.create(...)`; opting in with `local.settingSources: ["project"]` makes it discover
config from `.theokit/` in the working directory.

This example writes a throwaway project into a temp dir with two file-based conventions and
proves both end-to-end:

1. **Skills** — `.theokit/skills/release-checklist/SKILL.md` is discovered (shown by
   `agent.skills.list()`). Deterministic, no LLM.
2. **Context** — `.theokit/context/product-facts.md` is injected into the run. The agent is
   asked a question it can only answer from the file (a 2026 codename), so a correct reply
   proves the file reached the model — a **real LLM** check.

## Run

```bash
export OPENROUTER_API_KEY=sk-or-...   # or put it in the repo-root .env
pnpm install
pnpm run run
```

Requires a real provider key — the context assertion only passes against a live model.
