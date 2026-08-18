# @theokit/acp

Agent Client Protocol (ACP) server adapter for [`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk).

Exposes a `SDKAgent` over stdio JSON-RPC so any [ACP-compatible host](https://agentclientprotocol.com) can drive it as a coding agent — without writing any glue code.

```bash
npm i @theokit/acp @theokit/sdk @agentclientprotocol/sdk
```

## Quick start

```ts
// my-agent.ts (the file your ACP host will spawn)
import { Agent } from "@theokit/sdk";

export default async (sessionId: string) => {
  return Agent.create({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd() },
    name: `acp-${sessionId}`,
  });
};
```

```bash
# Launch the server (an ACP host will do this for you)
npx theokit-acp --entry ./my-agent.ts
```

## Permission modes

- `--permission ask` (default) — every tool call prompts the host UI.
- `--permission auto` — pass-through; no UI.
- `--permission deny` — reject every tool call (headless CI).
- `--trusted-tools read_file,list_dir` — names bypassed in `ask` mode.
- `--permission-timeout-ms 60000` — auto-deny after timeout (EC-2 / D355).

## Use in code

```ts
import { Agent } from "@theokit/sdk";
import { serveAcp } from "@theokit/acp";

await serveAcp({
  agent: async (sessionId) => Agent.create({ /* ... */ }),
  info: { name: "my-agent", version: "1.0.0" },
  permissionDefault: "ask",
  trustedTools: ["read_file", "list_dir"],
});
```

## Architecture

| ACP concept       | SDK mapping                                                    |
| ----------------- | -------------------------------------------------------------- |
| `new_session`     | `Agent.create({ local: { cwd } })`                            |
| `load_session`    | `Agent.resume(sessionId)` (D352)                              |
| `cancel`          | session `AbortController.abort()` (D354)                       |
| `prompt`          | `agent.send(text, { signal }).stream()` (D353)                |
| `tool permission` | `pre_tool_call` veto hook (D355)                              |
| `session/fork`    | deferred to v0.2 (D350)                                       |

## Versioning

Pre-1.0 (`0.x`). Breaking changes are allowed within `0.x` (D181 pattern) until upstream ACP stabilizes.

## License

Apache-2.0
