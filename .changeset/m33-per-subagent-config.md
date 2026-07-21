---
"@theokit/sdk": minor
---

Per-subagent config through the LOCAL delegation path. A disk-loaded subagent (`.theokit/agents/*.md`) may now set its own `model`, `reasoning_effort` and `sandbox`, and each reaches the spawned child — previously the local delegation seam narrowed an `AgentDefinition` to `{model.id, tools}` and dropped everything else.

- `reasoning_effort` rides inside the model as `model.params: [{ id: "thinking", value }]`; the spawn now carries the whole `ModelSelection` (with params) instead of only `.id`.
- `sandbox: true` (new optional `AgentDefinition.sandbox` boolean) forwards to the child as `local.sandboxOptions.enabled`. The SDK has no granular sandbox *mode*; a mode string is a typed load error, not a silent boolean coercion.
- The subagent loader now rejects unknown or unsupported frontmatter fields with a typed `ConfigurationError` naming the file and field (previously silently dropped): an unknown key, a non-boolean `sandbox`, `reasoning_effort` without a `model`, and `mcp` (not yet honored on the local delegation path — declare MCP servers in `.theokit/mcp.json` instead). Every `.theokit/agents/*.md` in the ecosystem already uses only accepted fields, so this is fail-closed with no real-world break.
- `buildChildCreateOptions` is now exported for testing the built child `AgentOptions`.
