---
"@theokit/sdk": minor
---

M4-6 — sub-agent tool scoping via `AgentDefinition.tools` (plan `m4-tool-scoping`).

- `AgentDefinition` gains an optional `tools?: string[]` — a tool-name whitelist. When set, the sub-agent may ONLY call tools whose canonical (post-repair, lowercase) name is in the list; any other call is vetoed at dispatch. Absent/empty → unscoped (inherits the parent's full toolset). Backward-compatible.
- `.theokit/agents/*.md` subagents can declare it as a comma/space-separated frontmatter field (`tools: read_file, list_dir`).
- New `@theokit/sdk/subagents` subpath: `subagentToolWhitelist(definition): Set<string> | undefined` + `withSubagentToolScope(definition, fn)` enforce the whitelist via the SDK's existing `withToolWhitelist` dispatch veto — the same enforcement `Agent.fork`'s `allowedTools` uses, NOT `PermissionEngine`. A `tools: ["read_file"]` sub-agent provably cannot call `write_file`/`shell_exec`.

Zero new dependencies.
