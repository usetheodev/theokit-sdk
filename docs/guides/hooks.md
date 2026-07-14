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

`.theokit/hooks.json` uses the **same shape as Claude Code's `settings.json` hooks** — a nested object keyed by lifecycle event, each event holding matcher-groups of shell commands:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "shell",
        "hooks": [
          { "type": "command", "command": "node .theokit/policy.js", "timeout": 30 }
        ]
      }
    ]
  }
}
```

- **Events** — `PreToolUse` / `PostToolUse` (filtered by `matcher` on the tool name), `UserPromptSubmit` (before a `send()`), `Stop` (run end). A Claude Code event with no SDK firing point (`SessionStart`, `PreCompact`, …) is skipped with a warning.
- **`matcher`** — a regex against the tool name (`PreToolUse` / `PostToolUse`); omit to match every tool.
- **`type`** — always `"command"`; **`command`** runs via `sh -c`; **`timeout`** is in seconds (default 30).
- The command receives the hook payload as **JSON on stdin** (`{ event, tool?, input?, agentId?, runId? }`); a **non-zero exit on `PreToolUse` / `UserPromptSubmit` blocks** the tool/run, or print `{"decision":"deny","reason":"…"}` on stdout.

> A legacy `.theokit/hooks/*.md` markdown form still loads but is deprecated (see ADR 0016) — migrate to `.theokit/hooks.json`.

## Reload without restart

If you edit `.theokit/hooks.json` while an agent is alive, call `agent.reload()` to pick up the new config without disposing:

```typescript
await agent.reload();
```

`reload()` re-reads hooks, project MCP, and subagents from the filesystem. The agent's conversation state is preserved.

## Next

- [MCP servers](./mcp-servers.md) — file-based MCP config follows the same precedence rules
- [Subagents](./subagents.md) — file-based subagent definitions live at `.theokit/agents/*.md`
