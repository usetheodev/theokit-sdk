# File-based config

`.theokit/` files augment a **code-created** agent. The agent is still made with
`Agent.create(...)`; opting in with `local.settingSources: ["project"]` makes it discover
config from `.theokit/` in the working directory.

This example writes a throwaway project into a temp dir and proves **five** file-based
conventions end-to-end — deterministic where a public inspector exists, and against a
**real LLM** where the file must actually change the model's behavior:

| Convention | File | Check |
| --- | --- | --- |
| **Skills** | `.theokit/skills/<name>/SKILL.md` | discovered via `agent.skills.list()` (deterministic) |
| **Context** | `.theokit/context/<name>.md` (`path:` → real file) | model answers a fact only on disk (`Project Halcyon`) — real LLM |
| **Rules** | `.theokit/rules/<name>.md` (`alwaysApply`) | reply obeys the rule (`[VERIFIED]` tag) — real LLM |
| **Subagents** | `.theokit/agents/<name>.md` | model delegates to the `fact-checker` tool — real LLM |
| **Hooks** | `.theokit/hooks.json` (Stop) | hook writes an observable marker file |

(MCP servers are also file-based via `.theokit/mcp.json` — see the `mcp` example, which
needs a live server to be meaningful.)

## Run

```bash
export OPENROUTER_API_KEY=sk-or-...   # or put it in the repo-root .env
pnpm install
pnpm run run
```

Requires a real provider key — the context/rule/subagent assertions only pass against a
live model. The script exits non-zero if any of the eight checks fail.
