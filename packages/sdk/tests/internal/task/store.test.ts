/**
 * Phase 2 (T2.1) RED tests for TaskStore.
 * Covers InMemoryTaskStore + JsonFileTaskStore + edge cases
 * EC-1 (mkdir), EC-2 (id grammar), EC-6 (ENOENT empty), EC-8 (.tmp skip).
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InvalidTaskIdError } from "../../../src/errors.js";
import {
  getTaskStoreFor,
  InMemoryTaskStore,
  JsonFileTaskStore,
} from "../../../src/internal/task/store.js";
import type { TaskHandle } from "../../../src/types/task.js";

function mkHandle(overrides: Partial<TaskHandle> = {}): TaskHandle {
  return {
    id: "t-1",
    kind: "custom",
    state: "queued",
    submittedAt: 1000,
    ...overrides,
  };
}

describe("InMemoryTaskStore", () => {
  let store: InMemoryTaskStore;

  beforeEach(() => {
    store = new InMemoryTaskStore();
  });

  it("insert + get returns the handle", async () => {
    await store.insert(mkHandle({ id: "alpha" }));
    const got = await store.get("alpha");
    expect(got?.id).toBe("alpha");
  });

  it("update via mutation fn returns the new handle", async () => {
    await store.insert(mkHandle({ id: "a", state: "queued" }));
    const next = await store.update("a", (h) => ({ ...h, state: "running" }));
    expect(next?.state).toBe("running");
    expect((await store.get("a"))?.state).toBe("running");
  });

  it("update returns undefined for missing id", async () => {
    expect(await store.update("missing", (h) => h)).toBeUndefined();
  });

  it("list filters by state", async () => {
    await store.insert(mkHandle({ id: "a", state: "running" }));
    await store.insert(mkHandle({ id: "b", state: "finished", finishedAt: 1500 }));
    const running = await store.list({ state: "running" });
    expect(running.length).toBe(1);
    expect(running[0]?.id).toBe("a");
  });

  it("list applies limit", async () => {
    for (let i = 0; i < 50; i++) await store.insert(mkHandle({ id: `id-${i}` }));
    expect((await store.list({ limit: 10 })).length).toBe(10);
  });

  it("evictTerminalOlderThan removes only terminal handles older than cutoff", async () => {
    await store.insert(mkHandle({ id: "old", state: "finished", finishedAt: 100 }));
    await store.insert(mkHandle({ id: "recent", state: "finished", finishedAt: 5000 }));
    await store.insert(mkHandle({ id: "running", state: "running" }));
    const removed = await store.evictTerminalOlderThan(1000);
    expect(removed).toBe(1);
    expect(await store.get("old")).toBeUndefined();
    expect(await store.get("recent")).toBeDefined();
    expect(await store.get("running")).toBeDefined();
  });
});

describe("JsonFileTaskStore", () => {
  let dir: string;
  let store: JsonFileTaskStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "task-store-"));
    store = new JsonFileTaskStore(join(dir, "tasks"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("EC-1: constructor creates dir recursively if missing", async () => {
    const deep = join(dir, "a", "b", "c");
    const deepStore = new JsonFileTaskStore(deep);
    await deepStore.insert(mkHandle({ id: "test" }));
    expect((await deepStore.get("test"))?.id).toBe("test");
  });

  it("EC-2: insert rejects invalid id grammar", async () => {
    await expect(store.insert(mkHandle({ id: "BAD UPPER" }))).rejects.toBeInstanceOf(
      InvalidTaskIdError,
    );
    await expect(store.insert(mkHandle({ id: "../etc/passwd" }))).rejects.toBeInstanceOf(
      InvalidTaskIdError,
    );
  });

  it("EC-6: list returns [] on fresh dir (ENOENT path)", async () => {
    const freshDir = join(dir, "nonexistent-yet");
    const freshStore = new JsonFileTaskStore(freshDir);
    // After construction the dir exists but is empty
    expect(await freshStore.list({})).toEqual([]);
  });

  it("insert persists to disk + get reads it back", async () => {
    await store.insert(mkHandle({ id: "persisted" }));
    const fresh = new JsonFileTaskStore(join(dir, "tasks"));
    expect((await fresh.get("persisted"))?.id).toBe("persisted");
  });

  it("update + persist round-trip", async () => {
    await store.insert(mkHandle({ id: "mut" }));
    await store.update("mut", (h) => ({ ...h, state: "running", startedAt: 2000 }));
    const fresh = new JsonFileTaskStore(join(dir, "tasks"));
    expect((await fresh.get("mut"))?.state).toBe("running");
  });

  it("EC-8: list ignores orphan .tmp files", async () => {
    await store.insert(mkHandle({ id: "good" }));
    // Plant an orphan tmp file as if a previous atomic write crashed.
    writeFileSync(join(dir, "tasks", "orphan.12345.tmp"), "garbage", "utf8");
    const result = await store.list({});
    expect(result.map((h) => h.id)).toEqual(["good"]);
  });

  it("corrupt JSON file is skipped (does not throw)", async () => {
    await store.insert(mkHandle({ id: "ok" }));
    writeFileSync(join(dir, "tasks", "bad.json"), "{not json", "utf8");
    const result = await store.list({});
    // "ok" still found; "bad" silently dropped
    expect(result.map((h) => h.id)).toEqual(["ok"]);
  });

  it("delete returns false for missing id", async () => {
    expect(await store.delete("never-existed")).toBe(false);
  });

  it("evictTerminalOlderThan removes terminal disk entries", async () => {
    await store.insert(mkHandle({ id: "old", state: "finished", finishedAt: 100 }));
    await store.insert(mkHandle({ id: "fresh", state: "finished", finishedAt: 9_999_999 }));
    const removed = await store.evictTerminalOlderThan(5000);
    expect(removed).toBe(1);
    expect(await store.get("old")).toBeUndefined();
    expect(await store.get("fresh")).toBeDefined();
  });
});

describe("getTaskStoreFor factory", () => {
  it("returns InMemoryTaskStore for { backend: 'memory' }", () => {
    expect(getTaskStoreFor({ backend: "memory" })).toBeInstanceOf(InMemoryTaskStore);
  });

  it("returns JsonFileTaskStore for { backend: 'json', dir }", () => {
    const dir = mkdtempSync(join(tmpdir(), "task-factory-"));
    expect(getTaskStoreFor({ backend: "json", dir })).toBeInstanceOf(JsonFileTaskStore);
  });
});
