import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import {
  clearAgentRegistry,
  invalidateRegistryHydration,
} from "../../../src/internal/runtime/agent-registry.js";
import {
  appendSessionMessage,
  clearAllSessions,
  compactSession,
  flushSessionWrites,
  getSessionMessages,
  hydrateSession,
} from "../../../src/internal/runtime/agent-session.js";
import {
  appendToSessionFile,
  readSessionFile,
  sessionFilePath,
} from "../../../src/internal/runtime/agent-session-store.js";

/**
 * ADR D18 + EC-2/EC-6/EC-7 — session messages persist to
 * `<cwd>/.theokit/agents/<agentId>/messages.jsonl` and survive restart.
 *
 * Tests use isolated tmpdirs so disk writes never collide across cases.
 */
describe("Agent session persistence (T1.1 / ADR D18)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-session-"));
    clearAllSessions();
    clearAgentRegistry();
  });

  afterEach(async () => {
    await flushSessionWrites();
    clearAllSessions();
    clearAgentRegistry();
    invalidateRegistryHydration();
    await rm(cwd, { recursive: true, force: true });
  });

  it("append-then-read-after-restart — appendSessionMessage; readSessionFile returns the appended turn", async () => {
    const agentId = "agent-test-append-read";
    appendSessionMessage(agentId, { role: "user", text: "hello world" }, cwd);
    appendSessionMessage(agentId, { role: "assistant", text: "hi back" }, cwd);
    await flushSessionWrites();

    // Simulate restart: drop in-memory, then read disk.
    clearAllSessions();
    const fromDisk = await readSessionFile(cwd, agentId);
    expect(fromDisk).toEqual([
      { role: "user", text: "hello world" },
      { role: "assistant", text: "hi back" },
    ]);
  });

  it("compaction-trims-to-cap — 500 records on disk → compactSession keeps last 200", async () => {
    const agentId = "agent-compaction-test";
    for (let i = 0; i < 500; i += 1) {
      await appendToSessionFile(cwd, agentId, {
        role: i % 2 === 0 ? "user" : "assistant",
        text: `turn ${i}`,
      });
    }
    await compactSession(agentId, cwd);
    const survived = await readSessionFile(cwd, agentId);
    expect(survived.length).toBe(200);
    expect(survived[0]?.text).toBe("turn 300");
    expect(survived[199]?.text).toBe("turn 499");
  });

  it("malformed-line-skipped (EC-7) — half-line + 3 valid → reader returns 3 + stderr warning", async () => {
    const agentId = "agent-malformed-test";
    const path = sessionFilePath(cwd, agentId);
    await mkdir(join(cwd, ".theokit", "agents", agentId), { recursive: true });
    const valid = [
      JSON.stringify({ role: "user", text: "first", at: 1 }),
      JSON.stringify({ role: "assistant", text: "second", at: 2 }),
      JSON.stringify({ role: "user", text: "third", at: 3 }),
    ];
    // Append a half-line (no closing brace, no newline at end) — simulates crash mid-write.
    await writeFile(path, `${valid.join("\n")}\n{"role":"user","text":"trunc`, "utf8");

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as unknown as { write: typeof origWrite }).write = ((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof origWrite;
    try {
      const messages = await readSessionFile(cwd, agentId);
      expect(messages.length).toBe(3);
      expect(messages.map((m) => m.text)).toEqual(["first", "second", "third"]);
    } finally {
      (process.stderr as unknown as { write: typeof origWrite }).write = origWrite;
    }
    expect(stderrChunks.some((c) => c.includes("malformed line"))).toBe(true);
  });

  it("per-agent-isolation — two agentIds → two files; neither sees the other", async () => {
    appendSessionMessage("agent-iso-a", { role: "user", text: "only A" }, cwd);
    appendSessionMessage("agent-iso-b", { role: "user", text: "only B" }, cwd);
    await flushSessionWrites();

    const a = await readSessionFile(cwd, "agent-iso-a");
    const b = await readSessionFile(cwd, "agent-iso-b");
    expect(a.map((m) => m.text)).toEqual(["only A"]);
    expect(b.map((m) => m.text)).toEqual(["only B"]);
  });

  it("persists-text-with-newlines (EC-6) — embedded \\n, \\t, and quotes round-trip", async () => {
    const agentId = "agent-newlines-test";
    const tricky = 'line1\nline2\twith\ttabs\nand "quoted" stuff';
    appendSessionMessage(agentId, { role: "user", text: tricky }, cwd);
    await flushSessionWrites();

    const fromDisk = await readSessionFile(cwd, agentId);
    expect(fromDisk[0]?.text).toBe(tricky);

    // And the file is valid JSONL — exactly one line per record.
    const raw = await readFile(sessionFilePath(cwd, agentId), "utf8");
    expect(raw.split("\n").filter((l) => l.length > 0).length).toBe(1);
  });

  it("jsonl-format-valid — every line is parseable JSON", async () => {
    const agentId = "agent-jsonl-validity";
    appendSessionMessage(agentId, { role: "user", text: "hello" }, cwd);
    appendSessionMessage(agentId, { role: "assistant", text: "world" }, cwd);
    await flushSessionWrites();

    const raw = await readFile(sessionFilePath(cwd, agentId), "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { role: string; text: string; at: number };
      expect(parsed.role === "user" || parsed.role === "assistant").toBe(true);
      expect(typeof parsed.text).toBe("string");
      expect(typeof parsed.at).toBe("number");
    }
  });

  it("hydrateSession — readSessionFile populates the in-memory cache for getSessionMessages", async () => {
    const agentId = "agent-hydrate-test";
    await mkdir(join(cwd, ".theokit", "agents", agentId), { recursive: true });
    const path = sessionFilePath(cwd, agentId);
    const lines = [
      JSON.stringify({ role: "user", text: "seeded user", at: 1 }),
      JSON.stringify({ role: "assistant", text: "seeded assistant", at: 2 }),
    ];
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");

    expect(getSessionMessages(agentId)).toEqual([]);
    await hydrateSession(agentId, cwd);
    expect(getSessionMessages(agentId).map((m) => m.text)).toEqual([
      "seeded user",
      "seeded assistant",
    ]);
  });

  it("session-survives-after-create-and-resume — Agent.create → send 1 → resume → getSessionMessages sees user turn", async () => {
    const agentId = "agent-survives-restart";
    const original = await Agent.create({
      agentId,
      apiKey: "theo_test_session_survives",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
    });
    const run = await original.send("first message that must survive restart");
    await run.wait();
    await original.dispose();

    // Simulate restart: clear in-memory caches.
    clearAllSessions();
    clearAgentRegistry();
    invalidateRegistryHydration();

    const resumed = await Agent.resume(agentId, { local: { cwd } });
    const messages = getSessionMessages(resumed.agentId);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.text).toContain("first message that must survive restart");
    await resumed.dispose();
  });

  it("compaction-during-append-no-loss (EC-2) — appends across the compaction threshold are all preserved", async () => {
    const agentId = "agent-ec2-compaction";
    // Seed 401 records so the next append crosses the 2x threshold for maxTurns=200.
    for (let i = 0; i < 401; i += 1) {
      await appendToSessionFile(cwd, agentId, { role: "user", text: `seed-${i}` });
    }
    // Now interleave new appends and a compaction. The mutex on the
    // `agent-send:<agentId>` key must serialize them.
    const pending: Promise<void>[] = [];
    pending.push(compactSession(agentId, cwd));
    for (let i = 0; i < 50; i += 1) {
      appendSessionMessage(agentId, { role: "user", text: `concurrent-${i}` }, cwd);
    }
    pending.push(flushSessionWrites());
    await Promise.all(pending);
    // Force a second compaction to settle the trim.
    await compactSession(agentId, cwd);

    const final = await readSessionFile(cwd, agentId);
    // All 50 concurrent-* texts must be present — they were never lost to
    // a compaction read+rename window.
    const concurrentTexts = final.filter((m) => m.text.startsWith("concurrent-"));
    expect(concurrentTexts.length).toBe(50);
  });

  it("skips-partial-last-line (EC-7) — 3 complete + half a 4th → reader returns 3, never throws", async () => {
    const agentId = "agent-partial-last";
    await mkdir(join(cwd, ".theokit", "agents", agentId), { recursive: true });
    const path = sessionFilePath(cwd, agentId);
    const complete = [
      JSON.stringify({ role: "user", text: "complete-1", at: 1 }),
      JSON.stringify({ role: "assistant", text: "complete-2", at: 2 }),
      JSON.stringify({ role: "user", text: "complete-3", at: 3 }),
    ].join("\n");
    // Half of a 4th record (no closing brace, no newline).
    await writeFile(path, `${complete}\n{"role":"assistant","text":"half-`, "utf8");

    await expect(readSessionFile(cwd, agentId)).resolves.toHaveLength(3);
  });
});
