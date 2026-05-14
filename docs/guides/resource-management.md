# Resource management

Agents and runs hold real resources — open HTTP connections, child processes, file handles, the local cron scheduler. Always dispose them.

## The `await using` pattern

TypeScript 5.2+ supports the [Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management) proposal:

```typescript
{
  await using agent = await Agent.create({ /* ... */ });
  const run = await agent.send("Do the thing");
  await run.wait();
} // agent is disposed automatically when the block exits
```

Pair with `try/catch` for error paths:

```typescript
try {
  await using agent = await Agent.create({ /* ... */ });
  await agent.send("Do the thing").then((r) => r.wait());
} catch (err) {
  console.error(err);
  // agent still disposed by `await using` on the way out
}
```

Requires Node 20.4+ at runtime and TypeScript 5.2+ at compile time.

## Explicit disposal

If you cannot use `await using` (older runtime, framework that owns lifecycles), call `dispose()` explicitly:

```typescript
const agent = await Agent.create({ /* ... */ });
try {
  await agent.send("Do the thing").then((r) => r.wait());
} finally {
  await agent.dispose();
}
```

## Fire-and-forget

`agent.close()` starts disposal without awaiting:

```typescript
agent.close(); // synchronous; resources released in the background
```

Use this only when you genuinely don't care about errors during teardown (process exit, shutdown handlers).

## Reload without dispose

`agent.reload()` re-reads filesystem config (hooks, project MCP, subagents) without disposing the agent:

```typescript
// Edit .theokit/hooks.json on disk
await agent.reload();
// Agent now sees the new hooks; conversation state preserved
```

## Cron scheduler

The local cron scheduler is a process-level resource. Start once, stop once:

```typescript
await Cron.start();
// … application runs …
process.on("SIGTERM", async () => {
  await Cron.stop();
  process.exit(0);
});
```

Calling `Cron.stop()` does NOT delete jobs. Calling `Cron.start()` again resumes scheduling.

## Lifecycle reference

| Method | Awaits? | Releases resources? | Notes |
| --- | --- | --- | --- |
| `agent.close()` | no | starts in background | Fire-and-forget. |
| `agent.dispose()` | yes | yes | Wait for full disposal. |
| `agent[Symbol.asyncDispose]()` | yes | yes | Implementation-side hook for `await using`. |
| `agent.reload()` | yes | no | Re-reads filesystem config. |
| `Cron.start()` | yes | starts scheduler | Required for local jobs to fire. |
| `Cron.stop()` | yes | stops scheduler | Jobs persisted on disk; resumes on next `start()`. |

## Next

- [Error handling](./error-handling.md) — clean disposal during error paths
- [Cron jobs](./cron-jobs.md) — scheduler lifecycle details
