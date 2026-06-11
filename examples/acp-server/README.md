# example-acp-server

Minimal `@theokit/acp` example: default-exports a per-session factory that creates a fresh `Agent` per ACP session.

## Run

### Local (manual, for testing)

```bash
# Install
pnpm install

# Set provider key
export OPENROUTER_API_KEY=sk-or-...

# Start the ACP server (stdin/stdout become the JSON-RPC channel)
pnpm serve
# OR explicitly:
npx theokit-acp --entry ./src/index.ts
```

The server will block reading from stdin. To talk to it manually, you need to send valid ACP `initialize` JSON-RPC frames. The realistic path is to point a host (Zed/Cursor) at it.

### Zed integration

```bash
mkdir -p ~/.config/zed/external_agents/usetheo-sdk
cp ../../packages/acp/registry/agent.json ~/.config/zed/external_agents/usetheo-sdk/
cp ../../packages/acp/registry/icon.svg ~/.config/zed/external_agents/usetheo-sdk/
```

Edit the `distribution.args` in the copied `agent.json` to point at this example's entry:

```json
{
  "distribution": {
    "type": "command",
    "command": "npx",
    "args": ["theokit-acp", "--entry", "/absolute/path/to/examples/acp-server/src/index.ts"],
    "env": { "OPENROUTER_API_KEY": "sk-or-..." }
  }
}
```

Restart Zed. Open External Agents → `Theokit SDK` should appear. Send a prompt.

## What it does

- ACP `new_session` → `Agent.create({ apiKey, model, local: { cwd } })` per session.
- ACP `prompt` → `agent.send(text).stream()` translated into ACP `agent_message_chunk` notifications.
- ACP `cancel` → fires the session's `AbortController`.
- Tool permissions → default `ask` mode prompts Zed UI; `--permission auto` to disable.

## Permissions

Default is `ask`. To trust the read-only tools and only prompt for writes:

```bash
npx theokit-acp --entry ./src/index.ts --trusted-tools read_file,list_dir,git_diff,search_text
```

## Notes

- Per `.claude/rules/real-llm-validation.md`, this example REQUIRES a real provider key. Fixture mode is not a valid dogfood substitute.
- Set `ACP_EXAMPLE_MODEL` to override the default model.
