/**
 * SE41 — the headline: an EXTERNAL SessionStore is the primary store AND resume
 * source. An in-memory Map store (standing in for Postgres / Redis) is shared
 * across two Agent instances in SIMULATED separate processes (the in-memory
 * session cache + registry are cleared between them, so nothing but the store
 * carries the history). The resumed agent hydrates its prior turns from the store
 * with NO local FS write — the serverless / multi-host use case SE40 dropped.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import type { SessionRecord } from "../../../src/internal/persistence/session-transcript.js";
import {
  clearAgentRegistry,
  invalidateRegistryHydration,
} from "../../../src/internal/runtime/registry/agent-registry.js";
import {
  clearAllSessions,
  getSessionMessages,
} from "../../../src/internal/session/agent-session.js";
import type { SessionStore } from "../../../src/types/session-store.js";

/** A real external-store impl (Map) — the Postgres/Redis shape, append-only. */
class MapSessionStore implements SessionStore {
  readonly byAgent = new Map<string, SessionRecord[]>();
  appendCalls = 0;
  async readRecords(agentId: string): Promise<SessionRecord[]> {
    return [...(this.byAgent.get(agentId) ?? [])];
  }
  async appendRecords(agentId: string, records: readonly SessionRecord[]): Promise<void> {
    this.appendCalls += 1;
    const prior = this.byAgent.get(agentId) ?? [];
    this.byAgent.set(agentId, [...prior, ...records]);
  }
}

/** Simulate a fresh process: only the external store survives. */
function coldRestart(): void {
  clearAllSessions();
  clearAgentRegistry();
  invalidateRegistryHydration();
}

describe("SE41 — external SessionStore resume across a cold start", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "se41-external-"));
  });
  afterEach(() => {
    coldRestart();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("a resumed agent hydrates prior turns from the external store (no local FS)", async () => {
    const store = new MapSessionStore();
    const agentId = "agent-se41-external";

    // Process 1 — plant a turn through the external store, then dispose.
    const a1 = await Agent.create({
      agentId,
      apiKey: "theo_test_se41_p1",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd, sessionStore: store },
    });
    const r1 = await a1.send("remember: the vault code is 4821");
    await r1.wait();
    await a1.dispose();

    // The record delta lives ONLY in the external store — nothing else persisted it.
    const stored = await store.readRecords(agentId);
    expect(stored.length).toBeGreaterThan(0);
    expect(store.appendCalls).toBeGreaterThan(0);

    // Cold restart: wipe the in-memory caches. Only `store` carries the history.
    coldRestart();

    // Process 2 — resume from the SAME external store; prior turns hydrate from it.
    const a2 = await Agent.resume(agentId, {
      apiKey: "theo_test_se41_p2",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd, sessionStore: store },
    });
    const hydrated = getSessionMessages(agentId);
    expect(hydrated.length).toBeGreaterThan(0);
    expect(hydrated.some((m) => m.role === "user" && m.text.includes("vault code is 4821"))).toBe(
      true,
    );

    // A follow-up turn appends to the SAME store (append-only — prior kept).
    const before = (await store.readRecords(agentId)).length;
    const r2 = await a2.send("what did I ask you to remember?");
    await r2.wait();
    await a2.dispose();
    const after = (await store.readRecords(agentId)).length;
    expect(after).toBeGreaterThan(before);
  });

  it("compact_boundary records flow through the external store's appendRecords (M50 size-driven)", async () => {
    const store = new MapSessionStore();
    const agentId = "agent-se41-compact";
    const agent = await Agent.create({
      agentId,
      apiKey: "theo_test_se41_compact",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd, sessionStore: store },
    });
    const run = await agent.send("turn 1");
    await run.wait();
    await agent.dispose();
    // M50 — the boundary is written by COMPACTION (size-driven or manual), not by turn count.
    // Compact through the executor with the external store: the boundary + replacement must flow
    // through the SAME appendRecords surface.
    const { compactSessionTranscript } = await import(
      "../../../src/internal/session/compact-session.js"
    );
    await compactSessionTranscript({
      store,
      loc: { cwd, agentId, model: "openai/gpt-4o-mini" },
      sessionId: agentId,
      trigger: "manual",
      summarize: async () => "summary via the external store",
    });
    const records = await store.readRecords(agentId);
    expect(records.some((r) => r.subtype === "compact_boundary")).toBe(true);
  });
});
