# Quickstart

The fastest way to get a Theo agent running: a local agent against your current working tree, streaming events as they come in.

## Hello, agent

```typescript
import { Agent } from "@usetheo/sdk";

const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "composer-2" },
  local: { cwd: process.cwd() },
});

const run = await agent.send("Summarize what this repository does");

for await (const event of run.stream()) {
  if (event.type === "assistant") {
    for (const block of event.message.content) {
      if (block.type === "text") process.stdout.write(block.text);
    }
  }
}
```

Each event is a discriminated `SDKMessage`. The full event taxonomy is in [Stream events](../concepts/stream-events.md).

## One-shot prompts

If you just want to run a prompt once and dispose, use `Agent.prompt()`:

```typescript
const result = await Agent.prompt("What does the auth middleware do?", {
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "composer-2" },
  local: { cwd: process.cwd() },
});

console.log(result.result);
```

## Multi-turn conversations

`Agent.create()` returns a handle you can `.send()` to repeatedly. Conversation state is preserved.

```typescript
const agent = await Agent.create({ /* ... */ });

const r1 = await agent.send("Find the bug in src/auth.ts");
await r1.wait();

const r2 = await agent.send("Fix it and add a regression test");
await r2.wait();
```

## Cleanup

Always dispose agents when done. The cleanest pattern is `await using` (TypeScript 5.2+):

```typescript
{
  await using agent = await Agent.create({ /* ... */ });
  const run = await agent.send("Do the thing");
  await run.wait();
} // agent disposed automatically here
```

Or call `dispose()` explicitly:

```typescript
await agent.dispose();
```

See [Resource management](../guides/resource-management.md) for the full lifecycle reference.

## Next

- [Authentication](./authentication.md) — API keys, service accounts
- [Agent and Run](../concepts/agent-and-run.md) — the two primitives in depth
- [Cron jobs](../guides/cron-jobs.md) — schedule recurring runs
