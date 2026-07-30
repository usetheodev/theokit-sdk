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
 *   - EC-14 (DOCUMENT): `list()` JSDoc documents the 256-row hard cap
 *     and the `submittedBefore` paging idiom.
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
   * Returns at most `filter.limit ?? 100` matching handles. JsonFile
   * backend hard-caps loaded entries at 256 — callers needing larger
   * pages must use `submittedBefore` to walk the timeline.
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
