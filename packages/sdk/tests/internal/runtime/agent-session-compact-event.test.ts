import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsSessionStore } from "../../../src/internal/persistence/fs-session-store.js";
import {
  clearAllSessions,
  flushSessionWrites,
  persistTurnToTranscript,
} from "../../../src/internal/session/agent-session.js";
import type { TranscriptLocation } from "../../../src/internal/session/agent-session-store.js";

/**
 * SE40 / SE2 — an append-only compaction (every COMPACTION_CHECK_INTERVAL=50
 * persisted turns) appends a `compact_boundary` record and invokes the optional
 * `onCompact` callback so the runtime can surface a `compact_boundary` RunEvent.
 */
describe("persistTurnToTranscript onCompact callback (SE2 compact_boundary)", () => {
  let baseDir: string;
  const cwd = "/tmp/compact-proj";
  function loc(agentId: string): TranscriptLocation {
    return { cwd, agentId, model: "test" };
  }
  const store = () => new FsSessionStore({ baseDir, cwd });

  beforeEach(() => {
    clearAllSessions();
    baseDir = mkdtempSync(join(tmpdir(), "theokit-compact-"));
  });
  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("fires onCompact once when 50 persisted turns cross the compaction boundary", async () => {
    let onCompactCalls = 0;
    for (let i = 0; i < 50; i++) {
      persistTurnToTranscript(
        store(),
        loc("agent-compact"),
        "agent-compact",
        { userText: `m${i}`, conversation: [] },
        () => {
          onCompactCalls += 1;
        },
      );
    }
    await flushSessionWrites();
    expect(onCompactCalls).toBe(1);
  });

  it("does not fire onCompact before the boundary", async () => {
    let onCompactCalls = 0;
    for (let i = 0; i < 10; i++) {
      persistTurnToTranscript(
        store(),
        loc("agent-compact-2"),
        "agent-compact-2",
        { userText: `m${i}`, conversation: [] },
        () => {
          onCompactCalls += 1;
        },
      );
    }
    await flushSessionWrites();
    expect(onCompactCalls).toBe(0);
  });
});
