import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { runActiveMemory } from "../../../src/internal/memory/active-memory.js";
import { ActiveMemoryCache } from "../../../src/internal/memory/active-memory-cache.js";
import { CircuitBreaker } from "../../../src/internal/memory/circuit-breaker.js";
import { IndexManager } from "../../../src/internal/memory/index-manager.js";
import { memoryDir, memoryMdPath } from "../../../src/internal/memory/markdown-store.js";

/**
 * Phase 8 T8.1 — Circuit breaker + cache + transcripts.
 */

function makeSlowIndex(delayMs: number): IndexManager {
  return {
    search: () => new Promise<[]>((resolve) => setTimeout(() => resolve([]), delayMs)),
  } as unknown as IndexManager;
}

describe("CircuitBreaker", () => {
  it("trips after maxTimeouts consecutive timeouts", async () => {
    const nowMs = 1000;
    const breaker = new CircuitBreaker({ maxTimeouts: 3, cooldownMs: 60_000, now: () => nowMs });
    expect(breaker.shouldSkip("agent-1")).toBe(false);
    breaker.recordTimeout("agent-1");
    breaker.recordTimeout("agent-1");
    breaker.recordTimeout("agent-1");
    expect(breaker.shouldSkip("agent-1")).toBe(true);
    // Other keys unaffected.
    expect(breaker.shouldSkip("agent-2")).toBe(false);
  });

  it("recovers after cooldown elapses", () => {
    let nowMs = 1000;
    const breaker = new CircuitBreaker({ maxTimeouts: 2, cooldownMs: 5000, now: () => nowMs });
    breaker.recordTimeout("k");
    breaker.recordTimeout("k");
    expect(breaker.shouldSkip("k")).toBe(true);
    nowMs += 6000;
    expect(breaker.shouldSkip("k")).toBe(false);
    expect(breaker.inspect("k").consecutiveTimeouts).toBe(0);
  });

  it("recordSuccess resets the counter", () => {
    const breaker = new CircuitBreaker({ maxTimeouts: 3 });
    breaker.recordTimeout("k");
    breaker.recordTimeout("k");
    expect(breaker.inspect("k").consecutiveTimeouts).toBe(2);
    breaker.recordSuccess("k");
    expect(breaker.inspect("k").consecutiveTimeouts).toBe(0);
  });
});

describe("ActiveMemoryCache", () => {
  it("returns cached result within TTL", () => {
    const nowMs = 100;
    const cache = new ActiveMemoryCache({ ttlMs: 10_000, now: () => nowMs });
    const value = { summary: "x", durationMs: 1, status: "ok" as const, hits: [] };
    cache.set("q", "message", value);
    expect(cache.get("q", "message")).toEqual(value);
  });

  it("expires entries past TTL", () => {
    let nowMs = 100;
    const cache = new ActiveMemoryCache({ ttlMs: 1000, now: () => nowMs });
    cache.set("q", "message", { summary: "x", durationMs: 1, status: "ok", hits: [] });
    nowMs += 2000;
    expect(cache.get("q", "message")).toBeUndefined();
  });

  it("keys by (userText, queryMode) — different modes ≠ same key", () => {
    const cache = new ActiveMemoryCache();
    cache.set("foo", "message", { summary: "A", durationMs: 1, status: "ok", hits: [] });
    expect(cache.get("foo", "message")?.summary).toBe("A");
    expect(cache.get("foo", "recent")).toBeUndefined();
  });
});

describe("runActiveMemory with breaker + cache", () => {
  it("breaker tripped → status=skipped without touching index", async () => {
    const breaker = new CircuitBreaker({ maxTimeouts: 1, cooldownMs: 60_000 });
    breaker.recordTimeout("agent-1");
    let called = 0;
    const index = {
      search: () => {
        called += 1;
        return Promise.resolve([]);
      },
    } as unknown as IndexManager;
    const result = await runActiveMemory({
      userText: "anything",
      priorMessages: [],
      index,
      options: { enabled: true },
      breaker,
      agentKey: "agent-1",
    });
    expect(result.status).toBe("skipped");
    expect(called).toBe(0);
  });

  it("cache hit skips a second call to the index", async () => {
    let calls = 0;
    const index = {
      search: () => {
        calls += 1;
        return Promise.resolve([]);
      },
    } as unknown as IndexManager;
    const cache = new ActiveMemoryCache();
    const opts = { enabled: true, queryMode: "message" as const };
    await runActiveMemory({
      userText: "repeat",
      priorMessages: [],
      index,
      options: opts,
      cache,
    });
    await runActiveMemory({
      userText: "repeat",
      priorMessages: [],
      index,
      options: opts,
      cache,
    });
    expect(calls).toBe(1);
  });

  it("breaker integrates: 3 timeouts in a row → 4th call skipped", async () => {
    const breaker = new CircuitBreaker({ maxTimeouts: 3, cooldownMs: 60_000 });
    const index = makeSlowIndex(200);
    for (let i = 0; i < 3; i++) {
      const r = await runActiveMemory({
        userText: `q${i}`,
        priorMessages: [],
        index,
        options: { enabled: true, timeoutMs: 20, queryMode: "message" },
        breaker,
        agentKey: "agent-x",
      });
      expect(r.status).toBe("timeout");
    }
    const fourth = await runActiveMemory({
      userText: "q-after-trip",
      priorMessages: [],
      index,
      options: { enabled: true, timeoutMs: 20, queryMode: "message" },
      breaker,
      agentKey: "agent-x",
    });
    expect(fourth.status).toBe("skipped");
  });
});

describe("transcript persistence", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-transcript-"));
    await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- magic 8675309.\n", "utf8");
  });

  it("writes transcript JSON when persistTranscripts=true", async () => {
    const index = await IndexManager.open({ cwd });
    await index.sync();
    await runActiveMemory({
      userText: "magic",
      priorMessages: [],
      index,
      options: { enabled: true, queryMode: "message" },
      cwd,
      persistTranscripts: true,
      runId: "test-run-1",
    });
    const transcriptsDir = join(memoryDir(cwd), "transcripts", "active-memory");
    expect(existsSync(transcriptsDir)).toBe(true);
    const files = await readdir(transcriptsDir);
    expect(files).toContain("test-run-1.json");
    const content = await readFile(join(transcriptsDir, "test-run-1.json"), "utf8");
    const parsed = JSON.parse(content) as { userText: string; status: string };
    expect(parsed.userText).toBe("magic");
    expect(parsed.status).toBe("ok");
    index.close();
  });

  it("does not write any file when persistTranscripts is omitted", async () => {
    const index = await IndexManager.open({ cwd });
    await index.sync();
    await runActiveMemory({
      userText: "magic",
      priorMessages: [],
      index,
      options: { enabled: true, queryMode: "message" },
      cwd,
    });
    const transcriptsDir = join(memoryDir(cwd), "transcripts", "active-memory");
    expect(existsSync(transcriptsDir)).toBe(false);
    index.close();
  });
});
