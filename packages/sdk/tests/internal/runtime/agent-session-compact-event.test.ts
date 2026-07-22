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
 * SE40 / SE2 / M50 — compaction is SIZE-DRIVEN (usage real >= 90% of the model's context window,
 * supplied via `turn.autoCompact`) and writes a summary-carrying replacement. The old 50-turn
 * no-summary boundary stub is GONE (it silently amnesia'd resumes). `onCompact` fires only when a
 * real compaction happens, so the runtime can surface the `compact_boundary` RunEvent.
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

  it("fires onCompact when size-driven auto-compaction crosses 90% of the context window (M50)", async () => {
    let onCompactCalls = 0;
    persistTurnToTranscript(
      store(),
      loc("agent-compact"),
      "agent-compact",
      {
        userText: "turno pesado",
        conversation: [],
        autoCompact: {
          usageTotal: 95_000,
          contextWindow: 100_000,
          summarize: async () => "resumo automático",
        },
      },
      () => {
        onCompactCalls += 1;
      },
    );
    await flushSessionWrites();
    expect(onCompactCalls).toBe(1);
  });

  it("fifty_turn_stub_removed — 51 turns below the threshold write NO boundary (M50)", async () => {
    let onCompactCalls = 0;
    for (let i = 0; i < 51; i++) {
      persistTurnToTranscript(
        store(),
        loc("agent-no-stub"),
        "agent-no-stub",
        {
          userText: `m${i}`,
          conversation: [],
          autoCompact: {
            usageTotal: 1_000,
            contextWindow: 100_000,
            summarize: async () => "não deveria rodar",
          },
        },
        () => {
          onCompactCalls += 1;
        },
      );
    }
    await flushSessionWrites();
    expect(onCompactCalls).toBe(0);
    const records = await store().readRecords("agent-no-stub");
    expect(records.some((r) => r.subtype === "compact_boundary")).toBe(false);
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
