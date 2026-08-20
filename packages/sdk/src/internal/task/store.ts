/**
 * `TaskStore` interface + 2 implementations (ADR D364).
 *
 *   - `InMemoryTaskStore` — default, transient, single-process.
 *   - `JsonFileTaskStore` — opt-in, one JSON file per task under a
 *     dedicated dir; single-process invariant (EC-15 documented).
 *
 * Edge cases absorbed:
 *   - EC-1: constructor auto-creates dir (mkdirSync recursive idempotent).
 *   - EC-2: every method validates the task id against the public
 *     grammar (D368) BEFORE doing any path I/O — path-traversal defense.
 *   - EC-6: `list()` returns `[]` on ENOENT (fresh install path).
 *   - EC-8: `list()` skips `.tmp.*` orphan files left by interrupted
 *     atomic writes.
 *   - EC-14 (DOCUMENT): `list()` JSDoc documents the 256-row hard cap.
 *     It no longer advertises `submittedBefore` as a way to page past it:
 *     the cap is applied to the raw directory listing before any filter, so
 *     paging beyond 256 files is not reachable through this interface.
 *   - EC-15 (DOCUMENT): `JsonFileTaskStore` JSDoc documents the
 *     single-process invariant; v0.2 SQLite covers cross-process.
 *
 * @internal
 */

import { mkdirSync, readdirSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import { InvalidTaskIdError } from "../../errors.js";
import {
  isValidTaskId,
  type TaskFilter,
  type TaskHandle,
  type TaskState,
  type TaskStoreOptions,
} from "../../types/task.js";
import { diag } from "../diagnostics.js";
import { atomicWriteText } from "../persistence/atomic-write.js";

const JSON_LOAD_CAP = 256;
const DEFAULT_LIST_LIMIT = 100;

/** Storage interface used by `TaskRegistry`. */
export interface TaskStore {
  insert(handle: TaskHandle): Promise<void>;
  update(id: string, mutate: (h: TaskHandle) => TaskHandle): Promise<TaskHandle | undefined>;
  get(id: string): Promise<TaskHandle | undefined>;
  /**
   * Returns at most `filter.limit ?? 100` matching handles.
   *
   * `JsonFileTaskStore` additionally reads at most 256 files per call, and that
   * cap is applied to the RAW directory listing — before `state`, `kind` and the
   * `submittedBefore` / `submittedAfter` window are considered. Past 256 task
   * files the visible set is therefore an arbitrary, readdir-ordered subset, and
   * `submittedBefore` narrows WITHIN that subset instead of paging beyond it.
   * `InMemoryTaskStore` has no such cap.
   */
  list(filter: TaskFilter): Promise<TaskHandle[]>;
  delete(id: string): Promise<boolean>;
  /** Removes terminal handles whose terminal-timestamp is older than `epochMs`. */
  evictTerminalOlderThan(epochMs: number): Promise<number>;
}

function assertValidIdForStore(id: string): void {
  if (!isValidTaskId(id, /* allowReserved */ true)) {
    throw new InvalidTaskIdError(`store rejects invalid task id: ${id}`, id);
  }
}

function terminalTimestamp(h: TaskHandle): number | undefined {
  if (h.state === "finished") return h.finishedAt;
  if (h.state === "error") return h.erroredAt;
  if (h.state === "cancelled") return h.cancelledAt;
  return undefined;
}

function isTerminal(state: TaskState): boolean {
  return state === "finished" || state === "error" || state === "cancelled";
}

function matchesState(h: TaskHandle, filter: TaskFilter): boolean {
  if (filter.state === undefined) return true;
  const states = Array.isArray(filter.state) ? filter.state : [filter.state];
  return states.includes(h.state);
}
function matchesKind(h: TaskHandle, filter: TaskFilter): boolean {
  if (filter.kind === undefined) return true;
  const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
  return kinds.includes(h.kind);
}
function matchesTime(h: TaskHandle, filter: TaskFilter): boolean {
  if (filter.submittedAfter !== undefined && h.submittedAt <= filter.submittedAfter) return false;
  if (filter.submittedBefore !== undefined && h.submittedAt >= filter.submittedBefore) return false;
  return true;
}
function matchesFilter(h: TaskHandle, filter: TaskFilter): boolean {
  return matchesState(h, filter) && matchesKind(h, filter) && matchesTime(h, filter);
}

function applyFilter(values: Iterable<TaskHandle>, filter: TaskFilter): TaskHandle[] {
  const limit = filter.limit ?? DEFAULT_LIST_LIMIT;
  const out: TaskHandle[] = [];
  for (const h of values) {
    if (matchesFilter(h, filter)) {
      out.push(h);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/* ─── InMemory ─── */

/**
 * Default `TaskStore` — a plain `Map` living in the current process.
 *
 * Nothing reaches disk and nothing survives the process, so a task recorded here
 * is invisible to a reader in another process (`theokit tasks`). Select it with
 * `getTaskStoreFor({ backend: "memory" })`.
 *
 * How it fails: every id-taking method validates against the task-id grammar
 * (`^[a-z0-9][a-z0-9_-]*$`; reserved `wf-`/`b-`/`cron-` prefixes are permitted
 * here) and throws `InvalidTaskIdError` before touching the map. A missing id is
 * reported by returning `undefined` (`get`, `update`) or `false` (`delete`), never
 * by throwing.
 *
 * Traps:
 *  - `insert()` is a `Map.set`: an existing id is overwritten silently, not
 *    rejected.
 *  - `list()` walks in INSERTION order and stops as soon as `filter.limit ?? 100`
 *    matches are collected. It never sorts, so the limit truncates an
 *    oldest-first scan rather than returning the most recent tasks.
 *  - Nothing evicts on its own; terminal handles accumulate until a caller invokes
 *    `evictTerminalOlderThan`.
 */
export class InMemoryTaskStore implements TaskStore {
  private readonly map = new Map<string, TaskHandle>();

  async insert(handle: TaskHandle): Promise<void> {
    assertValidIdForStore(handle.id);
    this.map.set(handle.id, handle);
  }

  async update(id: string, mutate: (h: TaskHandle) => TaskHandle): Promise<TaskHandle | undefined> {
    assertValidIdForStore(id);
    const existing = this.map.get(id);
    if (existing === undefined) return undefined;
    const next = mutate(existing);
    this.map.set(id, next);
    return next;
  }

  async get(id: string): Promise<TaskHandle | undefined> {
    assertValidIdForStore(id);
    return this.map.get(id);
  }

  async list(filter: TaskFilter): Promise<TaskHandle[]> {
    return applyFilter(this.map.values(), filter);
  }

  async delete(id: string): Promise<boolean> {
    assertValidIdForStore(id);
    return this.map.delete(id);
  }

  async evictTerminalOlderThan(epochMs: number): Promise<number> {
    let count = 0;
    for (const [id, h] of this.map.entries()) {
      if (!isTerminal(h.state)) continue;
      const ts = terminalTimestamp(h);
      if (ts !== undefined && ts < epochMs) {
        this.map.delete(id);
        count++;
      }
    }
    return count;
  }
}

/* ─── JsonFile (opt-in) ───
 *
 * IMPORTANT (EC-15): `JsonFileTaskStore` is **single-process**.
 * Concurrent writers from multiple Node processes against the same
 * directory may corrupt entries (atomic-write protects per-file, but
 * the `list()` scan + `update()` read-modify-write cycle is not
 * serialised across processes). Use only when the `TaskRegistry`
 * runs in exactly one process. v0.2 will add a SQLite backend with
 * the same interface for cross-process scenarios (D364 + D61).
 */
/**
 * Opt-in `TaskStore` that keeps one JSON file per task under `dir`, so another
 * process can read the registry off disk.
 *
 *   const store = new JsonFileTaskStore("/var/lib/theokit/tasks");
 *
 * Two calls are synchronous, and both are deliberate: the constructor creates `dir`
 * recursively (`mkdirSync`), and `list()` scans it with `readdirSync` before awaiting
 * anything. Every other operation is async — `get` uses `readFile`, `delete` uses
 * `unlink`, and every write goes through an atomic temp-file-plus-rename.
 *
 * SINGLE-PROCESS ONLY — see the note above. Per-file atomicity does not make
 * `update()` safe: it is a read-modify-write, so two writers that both `get`
 * before either writes lose one of the two mutations. That is true within one
 * process as well as across processes.
 *
 * How it fails:
 *  - An invalid id throws `InvalidTaskIdError` BEFORE any path is constructed.
 *    That ordering is the path-traversal defence, and it is why ids are validated
 *    rather than escaped.
 *  - A missing task is `undefined` from `get` and `false` from `delete`.
 *  - A file that exists but does not parse is NOT surfaced as an error: `get`
 *    writes to the diagnostics channel and returns `undefined`, so a corrupted
 *    task also silently vanishes from `list()`.
 *  - `list()` returns `[]` when `dir` does not exist; any other `readdir` failure
 *    (for example a permission error) throws.
 *
 * Traps:
 *  - `list()` loads at most 256 files and applies that cap to the raw directory
 *    listing, before any filter. Past 256 task files the result is an arbitrary
 *    readdir-ordered subset that `submittedBefore` cannot page beyond.
 *  - `list()` is `async`, but its directory scan is not: `readdirSync` blocks the event
 *    loop for the whole listing before the first `await`. Only the per-file reads that
 *    follow it are concurrent.
 *  - `evictTerminalOlderThan()` is built on that same capped `list()`, so one call
 *    is not guaranteed to have evicted everything eligible — call it until it
 *    returns 0.
 *  - Files whose name contains `.tmp` are skipped as orphans of an interrupted
 *    write, and nothing ever removes them.
 */
export class JsonFileTaskStore implements TaskStore {
  constructor(private readonly dir: string) {
    // EC-1: idempotent mkdir; ignore EEXIST.
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async insert(handle: TaskHandle): Promise<void> {
    assertValidIdForStore(handle.id);
    await atomicWriteText(this.filePath(handle.id), JSON.stringify(handle));
  }

  async update(id: string, mutate: (h: TaskHandle) => TaskHandle): Promise<TaskHandle | undefined> {
    assertValidIdForStore(id);
    const existing = await this.get(id);
    if (existing === undefined) return undefined;
    const next = mutate(existing);
    await atomicWriteText(this.filePath(id), JSON.stringify(next));
    return next;
  }

  async get(id: string): Promise<TaskHandle | undefined> {
    assertValidIdForStore(id);
    try {
      const raw = await readFile(this.filePath(id), "utf8");
      return JSON.parse(raw) as TaskHandle;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      // Corrupt JSON or other I/O error — log + degrade gracefully (D50/EC-7 cache pattern).
      diag(`[task-store] failed to read ${id}: ${(err as Error).message}\n`);
      return undefined;
    }
  }

  async list(filter: TaskFilter): Promise<TaskHandle[]> {
    let entries: string[];
    try {
      entries = readdirSync(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []; // EC-6
      throw err;
    }
    // EC-8: skip orphan .tmp files left by interrupted atomic writes.
    const candidates = entries
      .filter((name) => name.endsWith(".json") && !name.includes(".tmp"))
      .slice(0, JSON_LOAD_CAP);

    const loaded = await Promise.all(
      candidates.map(async (name) => {
        const id = name.slice(0, -".json".length);
        if (!isValidTaskId(id, true)) return undefined;
        return this.get(id);
      }),
    );
    const handles = loaded.filter((h): h is TaskHandle => h !== undefined);
    return applyFilter(handles, filter);
  }

  async delete(id: string): Promise<boolean> {
    assertValidIdForStore(id);
    try {
      await unlink(this.filePath(id));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  async evictTerminalOlderThan(epochMs: number): Promise<number> {
    const handles = await this.list({ state: ["finished", "error", "cancelled"], limit: 256 });
    let count = 0;
    for (const h of handles) {
      const ts = terminalTimestamp(h);
      if (ts !== undefined && ts < epochMs) {
        if (await this.delete(h.id)) count++;
      }
    }
    return count;
  }
}

/** Factory used by `TaskRegistry.configure` (D364). */
export function getTaskStoreFor(options: TaskStoreOptions): TaskStore {
  if (options.backend === "memory") return new InMemoryTaskStore();
  return new JsonFileTaskStore(options.dir);
}
