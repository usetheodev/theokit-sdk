# Hooks

Hooks are file-based only. There is no programmatic hook callback — hooks are a **project policy boundary**, not a per-run knob.

## Where hooks live

- **Local** — `.theokit/hooks.json` in the repo passed as `local.cwd`, or `~/.theokit/hooks.json` for user-level hooks.
- **Cloud** — commit `.theokit/hooks.json` and its scripts to the repo passed in `cloud.repos`. SDK-created cloud agents load project hooks automatically.

## Why file-based

Hooks codify project rules: "never run shell commands without confirming", "always log tool calls to this file", "block writes outside the `src/` directory". These rules should:

- Travel with the repo (in git).
- Apply to every agent invocation, regardless of which caller starts it.
- Survive an SDK upgrade — the format is owned by Theo, not by your code.

A programmatic `onHook` callback would tempt callers to special-case rules per invocation, which is the opposite of "policy". File-based keeps the discipline.

## Configuration format

The format and supported hook types are documented in the broader Theo hooks reference. The SDK's role is to load `.theokit/hooks.json` according to `local.settingSources` and pass it down to the runtime.

## Reload without restart

If you edit `.theokit/hooks.json` while an agent is alive, call `agent.reload()` to pick up the new config without disposing:

```typescript
await agent.reload();
```

`reload()` re-reads hooks, project MCP, and subagents from the filesystem. The agent's conversation state is preserved.

## Next

- [MCP servers](./mcp-servers.md) — file-based MCP config follows the same precedence rules
- [Subagents](./subagents.md) — file-based subagent definitions live at `.theokit/agents/*.md`
