---
user-invocable: false
paths:
  - "**/*task-store*"
  - "**/*taskstore*"
  - "**/*TaskStore*"
description: TheoKit SDK task persistence — @theokit/sdk/task-store (TaskStore interface, InMemoryTaskStore, JsonFileTaskStore, getTaskStoreFor factory)
---

# TheoKit Task Store

`@theokit/sdk/task-store` is the storage layer behind the task registry. Pick
`InMemoryTaskStore` (transient, single-process default) or `JsonFileTaskStore` (one JSON
file per task under a dir; single-process invariant — v0.2 SQLite covers cross-process).

```typescript
import {
  getTaskStoreFor,
  InMemoryTaskStore,
  JsonFileTaskStore,
  type TaskStore,
} from "@theokit/sdk/task-store";
```

## The `TaskStore` interface

All methods are async. `TaskHandle` / `TaskFilter` come from the main `@theokit/sdk`
barrel.

```typescript
interface TaskStore {
  insert(handle: TaskHandle): Promise<void>;
  update(id: string, mutate: (h: TaskHandle) => TaskHandle): Promise<TaskHandle | undefined>;
  get(id: string): Promise<TaskHandle | undefined>;
  list(filter: TaskFilter): Promise<TaskHandle[]>;
  delete(id: string): Promise<boolean>;
  evictTerminalOlderThan(epochMs: number): Promise<number>;
}
```

## Factory — `getTaskStoreFor`

Discriminated on `backend`; the `json` backend auto-creates its dir (mkdir recursive).

```typescript
const memory: TaskStore = getTaskStoreFor({ backend: "memory" });
const onDisk: TaskStore = getTaskStoreFor({ backend: "json", dir: ".theokit/tasks" });
```

Or construct directly:

```typescript
const store = new JsonFileTaskStore(".theokit/tasks"); // constructor(dir: string)
```

## Reading tasks

`list` returns at most `filter.limit ?? 100` handles; `JsonFileTaskStore` hard-caps
loaded entries at 256 — page larger timelines via `submittedBefore`.

```typescript
import type { TaskFilter } from "@theokit/sdk";

const filter: TaskFilter = { state: ["running", "queued"], kind: "run", limit: 50 };
const running = await store.list(filter);

for (const h of running) {
  console.log(h.id, h.state, h.submittedAt);
  if (h.cancelRequested) console.log("  (cross-process cancel requested)");
}
```

`cancelRequested` is set by the CLI's cross-process best-effort cancel (EC-7); the owning
process polls it at checkpoints. `evictTerminalOlderThan(epochMs)` removes terminal
handles older than a cutoff and returns the count removed.
