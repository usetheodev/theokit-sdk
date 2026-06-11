/**
 * `theokit tasks {list|inspect|cancel}` — operator-facing observability
 * for the SDK Task registry (Adoption Roadmap gap #2; ADRs D361-D374).
 *
 * Reads from the JsonFileTaskStore at `$THEOKIT_HOME/tasks/` (default
 * fallback `cwd/.theokit/tasks/`). Cross-process cancel is best-effort:
 * the CLI marks `cancelRequested: true` in the handle file, and the
 * owning process honors it at the next checkpoint (EC-7).
 *
 * Exit codes (consistent with the other subcommands in this package):
 *   0 — success
 *   2 — permission / I/O failure
 *   3 — invalid task id grammar (D368)
 *   4 — task not found
 */

import { join } from "node:path";

import type { TaskFilter, TaskHandle, TaskState } from "@theokit/sdk";
import { JsonFileTaskStore, type TaskStore } from "@theokit/sdk/task-store";

// Local copy of the id grammar — keeps the CLI dependency surface minimal
// and matches D368 (`^[a-z0-9][a-z0-9_-]*$`). Adapters use reserved
// prefixes wf-/b-/cron-; the CLI always allows them.
const TASK_ID_GRAMMAR = /^[a-z0-9][a-z0-9_-]*$/;
function isValidTaskId(id: string): boolean {
  return TASK_ID_GRAMMAR.test(id);
}

export interface TasksListOptions {
  state?: string;
  kind?: string;
  json?: boolean;
}

export interface TasksInspectOptions {
  json?: boolean;
}

export interface TasksCancelOptions {
  reason?: string;
}

function resolveStoreDir(): string {
  const fromEnv = process.env.THEOKIT_HOME;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return join(fromEnv, "tasks");
  return join(process.cwd(), ".theokit", "tasks");
}

function openStore(): TaskStore {
  const dir = resolveStoreDir();
  try {
    return new JsonFileTaskStore(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EACCES") {
      process.stderr.write(`tasks: cannot access store dir ${dir}: permission denied\n`);
      throw new Error("permission_denied");
    }
    throw err;
  }
}

function formatTable(handles: readonly TaskHandle[]): string {
  if (handles.length === 0) return "No tasks found.";
  const rows = handles.map((h) => ({
    id: h.id.slice(0, 24).padEnd(24),
    kind: h.kind.padEnd(8),
    state: h.state.padEnd(9),
    age: `${Math.floor((Date.now() - h.submittedAt) / 1000)}s`.padStart(6),
  }));
  const header = "ID                       KIND     STATE     AGE";
  const lines = rows.map((r) => `${r.id} ${r.kind} ${r.state} ${r.age}`);
  return [header, ...lines].join("\n");
}

async function listHandles(store: TaskStore, opts: TasksListOptions): Promise<TaskHandle[]> {
  const filter: TaskFilter = {
    ...(opts.state !== undefined ? { state: opts.state as TaskState } : {}),
    ...(opts.kind !== undefined ? { kind: opts.kind as TaskHandle["kind"] } : {}),
  };
  return store.list(filter);
}

export async function runTasksList(opts: TasksListOptions): Promise<number> {
  let store: TaskStore;
  try {
    store = openStore();
  } catch {
    return 2;
  }
  const handles = await listHandles(store, opts);
  if (opts.json === true) {
    process.stdout.write(`${JSON.stringify(handles, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatTable(handles)}\n`);
  }
  return 0;
}

function printHandleDetails(handle: TaskHandle): void {
  process.stdout.write(`id:           ${handle.id}\n`);
  process.stdout.write(`kind:         ${handle.kind}\n`);
  process.stdout.write(`state:        ${handle.state}\n`);
  process.stdout.write(`submittedAt:  ${new Date(handle.submittedAt).toISOString()}\n`);
  if (handle.startedAt !== undefined) {
    process.stdout.write(`startedAt:    ${new Date(handle.startedAt).toISOString()}\n`);
  }
  if (handle.finishedAt !== undefined) {
    process.stdout.write(`finishedAt:   ${new Date(handle.finishedAt).toISOString()}\n`);
    process.stdout.write(`result:       ${JSON.stringify(handle.result)}\n`);
  }
  if (handle.erroredAt !== undefined) {
    process.stdout.write(`erroredAt:    ${new Date(handle.erroredAt).toISOString()}\n`);
    process.stdout.write(`error:        ${JSON.stringify(handle.error)}\n`);
  }
  if (handle.cancelledAt !== undefined) {
    process.stdout.write(`cancelledAt:  ${new Date(handle.cancelledAt).toISOString()}\n`);
  }
  if (handle.cancelRequested === true) {
    process.stdout.write(`cancelRequested: true (awaiting owning process)\n`);
  }
}

export async function runTasksInspect(id: string, opts: TasksInspectOptions): Promise<number> {
  if (!isValidTaskId(id)) {
    process.stderr.write(`tasks: invalid id grammar: ${id}\n`);
    return 3;
  }
  let store: TaskStore;
  try {
    store = openStore();
  } catch {
    return 2;
  }
  const handle = await store.get(id);
  if (handle === undefined) {
    process.stderr.write(`tasks: not found: ${id}\n`);
    return 4;
  }
  if (opts.json === true) {
    process.stdout.write(`${JSON.stringify(handle, null, 2)}\n`);
  } else {
    printHandleDetails(handle);
  }
  return 0;
}

export async function runTasksCancel(id: string, _opts: TasksCancelOptions): Promise<number> {
  if (!isValidTaskId(id)) {
    process.stderr.write(`tasks: invalid id grammar: ${id}\n`);
    return 3;
  }
  let store: TaskStore;
  try {
    store = openStore();
  } catch {
    return 2;
  }
  const handle = await store.get(id);
  if (handle === undefined) {
    process.stderr.write(`tasks: not found: ${id}\n`);
    return 4;
  }
  if (handle.state === "finished" || handle.state === "error" || handle.state === "cancelled") {
    process.stdout.write(`task already terminal (state=${handle.state})\n`);
    return 0;
  }
  if (handle.state === "queued") {
    // Direct transition (no owning process AbortController to flip).
    const cancelledAt = Date.now();
    await store.update(id, (h) => ({ ...h, state: "cancelled", cancelledAt }));
    process.stdout.write(`task ${id} cancelled (was queued)\n`);
    return 0;
  }
  // Running: set cancelRequested flag; owning process honors at next checkpoint.
  await store.update(id, (h) => ({ ...h, cancelRequested: true }));
  process.stdout.write(
    `cancel requested for task ${id}; the owning process will honor it at the next checkpoint\n`,
  );
  return 0;
}
