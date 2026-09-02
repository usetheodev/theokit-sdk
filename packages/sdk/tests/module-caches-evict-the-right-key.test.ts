/**
 * M95 — HIGH-1 and HIGH-2 from adversarial review: the `delete`s used the wrong key.
 *
 * Three of the four maps are keyed by `transcriptKey(cwd, agentId)`; only `sessions` uses the
 * raw `agentId`. `discardSession` erased two of them by `agentId`, so it **never** erased anything
 * — and the previous test did not catch it because it only asserted the SECOND call returns 0,
 * which is true even if the first erases nothing.
 *
 * Worse, the LRU ceiling evicts `sessions` by `agentId` and left `hydratedKeys` behind. Since
 * `hydrateSession` returns early when the key is present, an evicted session came back **empty**
 * instead of rehydrating from disk: silent amnesia, and a NEW regression in M95 — before it nothing
 * evicted.
 */
import { describe, expect, it } from "vitest";
import {
  appendSessionMessage,
  discardSession,
  flushSessionWrites,
  MAX_CACHED_SESSIONS,
  persistTurnToTranscript,
} from "../src/internal/session/agent-session.js";
import { hydratedKeys, sessions, transcriptKey } from "../src/internal/session/session-cache.js";
import type { SessionRecord, SessionStore } from "../src/types/session-store.js";

const CWD = "/some/cwd";

/** A store that accepts everything — the target here is the caches, not persistence. */
const inertStore = (): SessionStore => ({
  readRecords: async (): Promise<SessionRecord[]> => [],
  appendRecords: async (): Promise<void> => undefined,
});

function clearAll(): void {
  for (const k of [...sessions.keys()]) sessions.delete(k);
  for (const k of [...hydratedKeys]) hydratedKeys.delete(k);
}

describe("M95/HIGH-1 — discardSession erases by the key the write used", () => {
  it("erases recordCounts after the flush", async () => {
    clearAll();
    // Populated via the REAL path — `persistTurnToTranscript` is what writes, and it uses
    // `transcriptKey(cwd, agentId)`. Populating by hand would test the double.
    persistTurnToTranscript(inertStore(), { cwd: CWD, agentId: "ag", model: "m" }, "ag", {
      userText: "oi",
      conversation: [],
    });
    await flushSessionWrites();
    hydratedKeys.add(transcriptKey(CWD, "ag"));
    // 2 = hydratedKeys + recordCounts. `pendingWrites` already left on flush, by design.
    expect(discardSession(CWD, "ag"), "recordCounts was not erased").toBe(2);
  });

  it("erases pendingWrites BEFORE the flush — the moment it exists", () => {
    clearAll();
    persistTurnToTranscript(inertStore(), { cwd: CWD, agentId: "ag2", model: "m" }, "ag2", {
      userText: "oi",
      conversation: [],
    });
    hydratedKeys.add(transcriptKey(CWD, "ag2"));
    // 2 = hydratedKeys + pendingWrites. `recordCounts` is only written once the write completes.
    expect(discardSession(CWD, "ag2"), "pendingWrites was not erased").toBe(2);
  });

  it("a second discard is a no-op", () => {
    clearAll();
    hydratedKeys.add(transcriptKey(CWD, "ag3"));
    expect(discardSession(CWD, "ag3")).toBe(1);
    expect(discardSession(CWD, "ag3")).toBe(0);
  });
});

describe("M95/HIGH-2 — the ceiling does not orphan hydratedKeys", () => {
  it("evicting a session via the ceiling also removes the hydration marker", () => {
    clearAll();
    // Fills to the ceiling, marking each one hydrated.
    for (let i = 0; i <= MAX_CACHED_SESSIONS; i++) {
      appendSessionMessage(`t-${i}`, { role: "user", text: "x" });
      hydratedKeys.add(transcriptKey(CWD, `t-${i}`));
    }
    expect(sessions.has("t-0"), "the oldest was not evicted").toBe(false);
    expect(
      hydratedKeys.has(transcriptKey(CWD, "t-0")),
      "the hydration marker was orphaned — the session comes back EMPTY instead of rehydrating from disk",
    ).toBe(false);
  });
});
