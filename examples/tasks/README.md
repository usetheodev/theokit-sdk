# example: tasks (observable async work)

Demonstrates the `Task` namespace from `@theokit/sdk` (Adoption Roadmap gap #2; ADRs D361-D374).

## Run (no LLM required)

```bash
pnpm install
pnpm run run
```

The work functions are deterministic — no `OPENROUTER_API_KEY` needed. To use a real LLM, wrap your `agent.send(prompt, { signal: ctx.signal })` call inside the `work` callback.

## What it shows

- `Task.submit(kind, work, options?)` — submit a unit of async work and receive a queued `TaskHandle`.
- `Task.subscribe(id)` — `AsyncIterable<TaskEvent>` with ring-buffer replay (D372) for late-attach safety.
- Fan-out **batch** pattern — 1 parent task whose work spawns N children with `meta: { item }` provenance.
- Idempotent **cancel** — `Task.cancel` returns `{ cancelled, alreadyTerminal }`; calling twice is safe.
- **JsonFileTaskStore** opt-in via `Task.configure({ store: { backend: "json", dir } })` — handles persist across restarts; inspect them via the CLI:

  ```bash
  THEOKIT_HOME=/tmp/theokit-tasks-example-XXX pnpm exec theokit tasks list
  ```

## v1 scope cut (documented)

`Agent.send` / `Agent.batch` / `Workflow.run` / `Cron.register` do **NOT** accept a `{ task: true }` option yet — that adapter integration is deferred to v0.2 (see plan v1.2). The user-side pattern in `run.ts` (`Task.submit("kind", async (ctx) => myAsyncWork(ctx))`) covers every observability use case today, with zero coupling to the underlying runtime.
