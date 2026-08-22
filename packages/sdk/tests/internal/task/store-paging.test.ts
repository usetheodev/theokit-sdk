import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { JsonFileTaskStore } from "../../../src/internal/task/store.js";
import type { TaskHandle } from "../../../src/types/task.js";

/**
 * #362 — the 256-file cap was applied to the RAW directory listing, before any filter.
 *
 * Past 256 task files the visible set was an arbitrary readdir-ordered subset, so:
 *  - `submittedBefore` — advertised by the `TaskStore.list` JSDoc as the way to page beyond the
 *    cap — narrowed WITHIN that subset instead of reaching past it, and
 *  - `evictTerminalOlderThan()`, built on the same capped `list()`, silently left eligible handles
 *    behind, so the directory grew without bound however many times it was called.
 */

let dir: string;

function writeTask(handle: TaskHandle): void {
  writeFileSync(join(dir, `${handle.id}.json`), JSON.stringify(handle));
}

/** `count` finished tasks, submitted one millisecond apart so the timeline is unambiguous. */
function seedFinished(count: number, startAt = 1_000): TaskHandle[] {
  const written: TaskHandle[] = [];
  for (let i = 0; i < count; i++) {
    const handle: TaskHandle = {
      id: `t-${String(i).padStart(4, "0")}`,
      kind: "custom",
      state: "finished",
      submittedAt: startAt + i,
      finishedAt: startAt + i + 1,
    } as TaskHandle;
    writeTask(handle);
    written.push(handle);
  }
  return written;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "task-paging-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("pages past 256 files with submittedBefore, covering every task exactly once", async () => {
  const total = 300;
  seedFinished(total);
  const store = new JsonFileTaskStore(dir);

  const seen = new Set<string>();
  let cursor: number | undefined;
  for (let page = 0; page < 10; page++) {
    const handles: TaskHandle[] = await store.list(
      cursor === undefined ? { limit: 50 } : { limit: 50, submittedBefore: cursor },
    );
    if (handles.length === 0) break;
    for (const h of handles) {
      expect(seen.has(h.id), `task ${h.id} returned twice`).toBe(false);
      seen.add(h.id);
    }
    cursor = Math.min(...handles.map((h) => h.submittedAt));
  }

  expect(seen.size).toBe(total);
});

it("evicts every eligible terminal handle, not just those inside a 256-file window", async () => {
  seedFinished(300);
  const store = new JsonFileTaskStore(dir);

  // Everything seeded is older than this, so a complete eviction removes all 300.
  const evicted = await store.evictTerminalOlderThan(1_000_000);

  expect(evicted).toBe(300);
  expect(await store.list({ limit: 500 })).toHaveLength(0);
});

it("returns the newest matching tasks first, and honours limit and filters", async () => {
  // The accepted cases (`testing.md` § 4.2). A `list` that returned everything unordered, or one
  // that stopped filtering, would satisfy the paging test above while breaking every ordinary call.
  seedFinished(5);
  writeTask({ id: "q-1", kind: "custom", state: "queued", submittedAt: 9_000 } as TaskHandle);
  const store = new JsonFileTaskStore(dir);

  const newest = await store.list({ limit: 2 });
  expect(newest.map((h) => h.id)).toEqual(["q-1", "t-0004"]);

  const finished = await store.list({ state: ["finished"], limit: 10 });
  expect(finished).toHaveLength(5);
  expect(finished.every((h) => h.state === "finished")).toBe(true);
});
