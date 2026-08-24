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
   * `JsonFileTaskStore` returns them newest-first and considers every task in its
   * directory, reading at most 256 files concurrently (#362 — that number bounds
   * I/O, not which tasks are visible). Walk past `limit` by passing the oldest
   * `submittedAt` of a page as the next call's `submittedBefore`; the ordering is
   * what makes that a cursor rather than a re-roll of an arbitrary subset.
   * `InMemoryTaskStore` applies the same filters but does not order its result.
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

/** The states `evictTerminalOlderThan` considers terminal. */
const TERMINAL_STATES: readonly TaskState[] = ["finished", "error", "cancelled"];

/**
 * Where `submittedAt` belongs in a newest-first list — the first index whose entry is older.
 *
 * Linear rather than binary: the list is bounded by the caller's `limit` (100 by default) and the
 * scan runs once per MATCHING handle, so the comparison count is dwarfed by the file read that
 * produced the handle. A binary search here would trade a real cost for an imagined one.
 */
function insertionIndex(newestFirst: readonly TaskHandle[], submittedAt: number): number {
  for (let i = 0; i < newestFirst.length; i++) {
    const entry = newestFirst[i];
    if (entry !== undefined && entry.submittedAt < submittedAt) return i;
  }
  return newestFirst.length;
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
 *  - `list()` reads every task file in the directory (256 at a time) to apply the
 *    filter, because `state`, `kind` and `submittedAt` live inside the files. On a
 *    large directory that is a lot of I/O for one call; the memory it holds is
 *    bounded by `limit`, the time is not.
 *  - `list()` is `async`, but its directory scan is not: `readdirSync` blocks the event
 *    loop for the whole listing before the first `await`. Only the per-file reads that
 *    follow it are concurrent.
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

  /**
   * Task ids backed by a file in `dir`, in readdir order.
   *
   * EC-8: orphan `.tmp` files left by an interrupted atomic write are skipped, as is any name
   * outside the id grammar. EC-6: a missing directory lists as empty; any other `readdir` failure
   * (a permission error, say) throws rather than being reported as "no tasks".
   */
  private candidateIds(): string[] {
    let entries: string[];
    try {
      entries = readdirSync(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []; // EC-6
      throw err;
    }
    return entries
      .filter((name) => name.endsWith(".json") && !name.includes(".tmp"))
      .map((name) => name.slice(0, -".json".length))
      .filter((id) => isValidTaskId(id, true));
  }

  /**
   * Read every task in `ids`, handing each loaded handle to `visit`, at most `JSON_LOAD_CAP` file
   * reads in flight.
   *
   * #362 — the cap used to be applied to the directory listing, which made it a bound on WHICH
   * tasks were visible rather than on how much I/O ran at once. Every filter then ran on that
   * arbitrary readdir-ordered prefix. As a concurrency bound it does the job it was named for
   * without deciding what the caller gets to see; the caller's own bound on memory is whatever
   * `visit` chooses to retain.
   */
  private async forEachHandle(
    ids: readonly string[],
    visit: (handle: TaskHandle) => void | Promise<void>,
  ): Promise<void> {
    for (let start = 0; start < ids.length; start += JSON_LOAD_CAP) {
      const batch = ids.slice(start, start + JSON_LOAD_CAP);
      const loaded = await Promise.all(batch.map(async (id) => this.get(id)));
      for (const handle of loaded) {
        if (handle !== undefined) await visit(handle);
      }
    }
  }

  async list(filter: TaskFilter): Promise<TaskHandle[]> {
    const limit = filter.limit ?? DEFAULT_LIST_LIMIT;
    // Newest-first, keeping at most `limit` handles in memory regardless of how many match. The
    // order is what makes `submittedBefore` a real cursor: with the previous readdir order, a page
    // was an arbitrary subset, so a caller walking the timeline skipped every task that happened
    // to fall outside its window and could never come back for them.
    const newest: TaskHandle[] = [];
    await this.forEachHandle(this.candidateIds(), (handle) => {
      if (!matchesFilter(handle, filter)) return;
      const at = insertionIndex(newest, handle.submittedAt);
      if (at >= limit) return; // older than everything already held, and the page is full
      newest.splice(at, 0, handle);
      if (newest.length > limit) newest.pop();
    });
    return newest;
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
    // #362 — eviction scans the directory itself rather than borrowing `list()`. Sharing that path
    // made one call incomplete twice over: it saw only a 256-file window, and it wanted the OLDEST
    // handles while `list()` is ordered newest-first — so on a large directory it could delete
    // nothing while thousands of eligible handles sat just outside the page. Sweeping every
    // candidate is what lets one call mean "everything eligible is gone".
    let count = 0;
    await this.forEachHandle(this.candidateIds(), async (handle) => {
      if (!TERMINAL_STATES.includes(handle.state)) return;
      const ts = terminalTimestamp(handle);
      if (ts === undefined || ts >= epochMs) return;
      if (await this.delete(handle.id)) count++;
    });
    return count;
  }
}

/** Factory used by `TaskRegistry.configure` (D364). */
export function getTaskStoreFor(options: TaskStoreOptions): TaskStore {
  if (options.backend === "memory") return new InMemoryTaskStore();
  return new JsonFileTaskStore(options.dir);
}
