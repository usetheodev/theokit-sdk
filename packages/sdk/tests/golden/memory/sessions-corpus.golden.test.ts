import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import { IndexManager } from "../../../src/internal/memory/index-manager.js";
import { memoryDir } from "../../../src/internal/memory/markdown-store.js";
import { discoverSessionFiles } from "../../../src/internal/memory/session-loader.js";
import {
  sessionSummaryPath,
  sessionsDir,
  writeSessionSummary,
} from "../../../src/internal/memory/session-summary-writer.js";
import {
  clearAgentRegistry,
  invalidateRegistryHydration,
} from "../../../src/internal/runtime/agent-registry.js";
import {
  clearAllSessions,
  flushSessionWrites,
} from "../../../src/internal/runtime/agent-session.js";

/**
 * ADR D20 + EC-3 + EC-9 — corpus="sessions" recall. After every finished run,
 * the SDK writes `.theokit/memory/sessions/<runId>.md`. IndexManager picks it
 * up with `source="sessions"`. `memory_search({ corpus: "sessions" })`
 * filters by that source. Cancelled / errored runs do NOT write summaries.
 */
describe("Session-corpus indexing (T3.1 / ADR D20)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-sessions-corpus-"));
    clearAllSessions();
    clearAgentRegistry();
    invalidateRegistryHydration();
  });

  afterEach(async () => {
    await flushSessionWrites();
    clearAllSessions();
    clearAgentRegistry();
    invalidateRegistryHydration();
    await rm(cwd, { recursive: true, force: true });
  });

  it("session-summary-written-on-run-finish — agent.send → run.wait → .md exists with user+assistant", async () => {
    const agent = await Agent.create({
      agentId: "agent-summary-write",
      apiKey: "theo_test_summary_write",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
    });
    const run = await agent.send("magic-number question");
    const result = await run.wait();
    await agent.dispose();

    expect(result.status).toBe("finished");
    const summaryPath = sessionSummaryPath(cwd, result.id);
    const body = await readFile(summaryPath, "utf8");
    expect(body).toContain("## User");
    expect(body).toContain("magic-number question");
    expect(body).toContain("## Assistant");
    expect(body).toMatch(/status: finished/);
  });

  it("memory-search-corpus-sessions-returns-hit — pre-seed sessions/, search returns ranked hit", async () => {
    await mkdir(sessionsDir(cwd), { recursive: true });
    await writeSessionSummary({
      cwd,
      runId: "run-prefill-1",
      agentId: "agent-seed",
      userText: "what's the magic-number for this workspace?",
      assistantText: "The magic-number is 8675309.",
      status: "finished",
      at: Date.now(),
    });
    await writeSessionSummary({
      cwd,
      runId: "run-prefill-2",
      agentId: "agent-seed",
      userText: "tell me about vitest",
      assistantText: "Vitest is a fast Vite-native test runner.",
      status: "finished",
      at: Date.now(),
    });

    const index = await IndexManager.open({ cwd });
    try {
      await index.sync();
      const hits = await index.search("magic-number", {
        maxResults: 5,
        sources: ["sessions"],
      });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((h) => h.source === "sessions")).toBe(true);
      expect(hits[0]?.snippet ?? "").toMatch(/magic-number|8675309/i);
    } finally {
      index.close();
    }
  });

  it("memory-search-corpus-memory-excludes-sessions — corpus filter is strict", async () => {
    // Seed a session file + a MEMORY.md fact mentioning the same keyword.
    await mkdir(memoryDir(cwd), { recursive: true });
    await writeFile(
      join(memoryDir(cwd), "MEMORY.md"),
      "# Memory\n\n- The favorite framework is Vitest.\n",
      "utf8",
    );
    await mkdir(sessionsDir(cwd), { recursive: true });
    await writeSessionSummary({
      cwd,
      runId: "run-session-vitest",
      agentId: "agent-seed",
      userText: "remind me about vitest",
      assistantText: "Vitest is the favorite framework.",
      status: "finished",
      at: Date.now(),
    });

    const index = await IndexManager.open({ cwd });
    try {
      await index.sync();
      const memoryHits = await index.search("Vitest", {
        maxResults: 10,
        sources: ["memory"],
      });
      expect(memoryHits.every((h) => h.source === "memory")).toBe(true);
      expect(memoryHits.length).toBeGreaterThan(0);
      // No leak from sessions/ into memory-only filter.
      expect(memoryHits.every((h) => !h.path.includes("sessions/"))).toBe(true);
    } finally {
      index.close();
    }
  });

  it("session-summary-redacts-secrets — sk-* tokens replaced before write", async () => {
    await writeSessionSummary({
      cwd,
      runId: "run-redact-test",
      agentId: "agent-redact",
      userText: "share my key sk-real-leaked-token-1234567890",
      assistantText: "I won't repeat your sk-other-leak-xyz token.",
      status: "finished",
      at: Date.now(),
    });
    const body = await readFile(sessionSummaryPath(cwd, "run-redact-test"), "utf8");
    expect(body).not.toContain("sk-real-leaked-token-1234567890");
    expect(body).not.toContain("sk-other-leak-xyz");
  });

  it("malformed-session-file-skipped — corrupt .md file does not crash sync", async () => {
    await mkdir(sessionsDir(cwd), { recursive: true });
    // Valid file
    await writeSessionSummary({
      cwd,
      runId: "run-valid",
      agentId: "agent-x",
      userText: "valid question",
      assistantText: "valid answer",
      status: "finished",
      at: Date.now(),
    });
    // Corrupt file (binary bytes)
    await writeFile(
      join(sessionsDir(cwd), "corrupt.md"),
      Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x03]),
    );

    const index = await IndexManager.open({ cwd });
    try {
      // sync() must complete without throwing despite the corrupt entry.
      const stats = await index.sync();
      expect(stats.filesScanned).toBeGreaterThanOrEqual(1);
    } finally {
      index.close();
    }
  });

  it("session-searchable-after-run-wait (EC-3) — run.wait → memory_search returns the just-finished run", async () => {
    const agent = await Agent.create({
      agentId: "agent-search-after-finish",
      apiKey: "theo_test_search_after_finish",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
      memory: {
        enabled: true,
        namespace: "ec-3-test",
      },
    });
    // Trigger memory tools so the IndexManager opens (otherwise syncIfReady is no-op).
    const run = await agent.send("the special-token-ec3 is 42");
    await run.wait();
    // Wait a microtask cycle for the background sync to settle.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    await agent.dispose();

    // Confirm the summary file exists.
    const sessionFiles = await discoverSessionFiles(cwd);
    expect(sessionFiles.length).toBeGreaterThanOrEqual(1);

    // Open a fresh index and confirm the session is searchable with the
    // distinguishing token.
    const index = await IndexManager.open({ cwd });
    try {
      await index.sync();
      const hits = await index.search("special-token-ec3", {
        maxResults: 5,
        sources: ["sessions"],
      });
      expect(hits.length).toBeGreaterThan(0);
    } finally {
      index.close();
    }
  });

  it("no-summary-on-cancelled-run (EC-9) — non-finished status writes nothing", async () => {
    // Direct unit test of writeSessionSummary: cancelled/error/running statuses
    // must return without touching disk.
    for (const status of ["running", "error", "cancelled"] as const) {
      await writeSessionSummary({
        cwd,
        runId: `run-${status}`,
        agentId: "agent-x",
        userText: "u",
        assistantText: "a",
        status,
        at: Date.now(),
      });
    }
    // No files written under sessions/.
    let entries: string[] = [];
    try {
      entries = await readdir(sessionsDir(cwd));
    } catch {
      entries = [];
    }
    expect(entries.length).toBe(0);
  });

  it('no-summary-on-errored-run (EC-9) — only status === "finished" triggers a write', async () => {
    await writeSessionSummary({
      cwd,
      runId: "run-finished-ok",
      agentId: "agent-y",
      userText: "user",
      assistantText: "assistant",
      status: "finished",
      at: Date.now(),
    });
    await writeSessionSummary({
      cwd,
      runId: "run-errored",
      agentId: "agent-y",
      userText: "user",
      assistantText: "assistant",
      status: "error",
      at: Date.now(),
    });
    const entries = await readdir(sessionsDir(cwd));
    expect(entries).toContain("run-finished-ok.md");
    expect(entries).not.toContain("run-errored.md");
  });
});
