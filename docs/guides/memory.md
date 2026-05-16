# Memory

Memory stores durable facts across agent instances. It is keyed by namespace, user, and scope so one user's facts do not leak into another user's run.

## Enabling Memory

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  memory: {
    enabled: true,
    namespace: "my-app",
    userId: "user-123",
    scope: "user",
  },
});

await (await agent.send("Remember: my preferred test runner is Vitest.")).wait();
```

```typescript
interface MemoryOptions {
  enabled: boolean;
  namespace?: string;
  userId?: string;
  scope?: "agent" | "user" | "team";
  storePath?: string;
}
```

## Scopes

| Scope | Use For |
| --- | --- |
| `"agent"` | Durable state for one agent ID. |
| `"user"` | Stable user preferences across agent instances. Requires `userId` for isolation. |
| `"team"` | Shared team facts that are safe for every authorized caller. |

## Safety Rules

Memory must not store API keys, bearer tokens, passwords, authorization headers, or other credential material. If the user asks the agent to remember a secret, the runtime should redact or reject that fact.

For local agents, `storePath` is resolved relative to the workspace. Paths that escape the workspace, such as `../memory.json`, raise `ConfigurationError`.

## Resume Behavior

Memory is durable by namespace, user, and scope, not by JavaScript process. Recreating or resuming an agent with the same memory configuration can recall durable facts. Inline secrets and inline MCP servers are not persisted through memory.
