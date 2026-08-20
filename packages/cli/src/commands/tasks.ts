/**
 * `theokit tasks {list|inspect|cancel}` — operator-facing observability
 * for the SDK Task registry (Adoption Roadmap gap #2; ADRs D361-D374).
 *
 * Reads from the JsonFileTaskStore at `$THEOKIT_HOME/tasks/` (default
 * fallback `cwd/.theokit/tasks/`). Cross-process cancel is best-effort:
 * the CLI marks `cancelRequested: true` in the handle file, and the
 * owning process honors it at the next checkpoint (EC-7).
 *
 * Exit codes:
 *   0 — success, INCLUDING a cancel of an already-terminal task and an empty list
 *   2 — the store directory could not be opened
 *   3 — invalid task id grammar (D368)
 *   4 — task not found
 *
 * These three commands are read-mostly and never start work: they observe a store some other process
 * owns. An empty listing means "nothing in THIS store dir", which is usually a `THEOKIT_HOME`
 * mismatch rather than an idle system.
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

/** Flags for {@link runTasksList}. Filter values are passed through to the store unvalidated. */
export interface TasksListOptions {
  /** `queued` | `running` | `finished` | `error` | `cancelled`. An unknown value simply matches nothing. */
  state?: string;
  /** `run` | `batch` | `workflow` | `cron` | `custom`. An unknown value simply matches nothing. */
  kind?: string;
  /** Emit the raw handles as JSON. The table view is lossy — see {@link runTasksList}. */
  json?: boolean;
}

/** Flags for {@link runTasksInspect}. */
export interface TasksInspectOptions {
  /** Emit the raw handle as JSON instead of the labelled field list. */
  json?: boolean;
}

/** Flags for {@link runTasksCancel}. */
export interface TasksCancelOptions {
  /**
   * Accepted by the CLI and NOT implemented: nothing reads this field, so no reason is written to
   * the registry and `--reason` has no observable effect.
   */
  reason?: string;
}

/**
 * Where the task store lives: `$THEOKIT_HOME/tasks` when `THEOKIT_HOME` is set and non-empty,
 * otherwise `<cwd>/.theokit/tasks`.
 *
 * Read fresh on every command, so the CLI must run with the same `THEOKIT_HOME` and — on the
 * fallback path — the same working directory as the process that owns the tasks.
 */
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

/**
 * List tasks from the local `JsonFileTaskStore`, filtered by `--state` / `--kind`.
 *
 * The default table TRUNCATES the id to 24 characters and shows no timestamps — it is for scanning,
 * not for scripting. Pass `--json` for the untruncated handles, including `result`, `error` and
 * `cancelRequested`.
 *
 * Returns 2 when the store directory cannot be opened, otherwise 0 — an empty result is a success.
 */
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

/**
 * Print one task handle by id.
 *
 * Returns 3 when `id` does not match `^[a-z0-9][a-z0-9_-]*$` (checked before the store is touched),
 * 2 when the store cannot be opened, 4 when no such task exists, 0 otherwise.
 */
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

/**
 * Ask for a task to stop. Best-effort and asynchronous — this never kills a process.
 *
 * Three outcomes, all exit 0: a task already `finished` / `error` / `cancelled` is left untouched; a
 * `queued` task is transitioned to `cancelled` directly in the store, because no process owns it
 * yet; a `running` task only gets `cancelRequested: true` written, and stops when its owner reaches
 * its next checkpoint (EC-7). A `running` task whose owner is dead therefore stays `running` forever
 * with the flag set — inspect it to see that state.
 *
 * Returns 3 for a malformed id, 2 when the store cannot be opened, 4 when the task does not exist.
 */
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
