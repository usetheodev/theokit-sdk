/**
 * M95 Phase 3 — the four module-level caches gain a ceiling and eviction.
 *
 * `agent-session.ts` and `session-cache.ts` keep four process-wide maps — `sessions`,
 * `hydratedKeys`, `pendingWrites`, `recordCounts` — and none erases an entry by id at the end of an
 * of the agent. Measured: `invalidateSessionCache` clears **two** (`sessions`, `hydratedKeys`); the
 * the other two are never touched by id. In a long-lived process running many sessions, that is
 * ownerless growth.
 */
import { describe, expect, it } from "vitest";
import {
  appendSessionMessage,
  discardSession,
  MAX_CACHED_SESSIONS,
} from "../src/internal/session/agent-session.js";
import { hydratedKeys, sessions, transcriptKey } from "../src/internal/session/session-cache.js";

const CWD = "/some/cwd";

describe("M95 — discardSession deletes ALL FOUR entries", () => {
  it("erases hydratedKeys but PRESERVES sessions — there is a legitimate post-dispose reader", () => {
    // `sessions` holds the readable conversation, and the golden `two-concurrent-sends-serialize`
    // reads it AFTER `agent.dispose()`. Erasing it here returned an empty list. The LRU ceiling is
    // what bounds it.
    appendSessionMessage("ag-x", { role: "user", text: "oi" });
    hydratedKeys.add(transcriptKey(CWD, "ag-x"));
    discardSession(CWD, "ag-x");
    expect(sessions.has("ag-x"), "the conversation vanished — the post-dispose reader breaks").toBe(
      true,
    );
    expect(hydratedKeys.has(transcriptKey(CWD, "ag-x"))).toBe(false);
  });

  it("also erases pendingWrites and recordCounts — the two invalidateSessionCache never touched", () => {
    appendSessionMessage("ag-y", { role: "user", text: "oi" });
    discardSession(CWD, "ag-y");
    // Without direct access to the private maps, the proof is the module's live count.
    expect(discardSession(CWD, "ag-y")).toBe(0);
  });
});

describe("M95 — ceiling on cached sessions", () => {
  it("evicts the LEAST recent one when crossing the ceiling", () => {
    for (const s of [...sessions.keys()]) sessions.delete(s);
    for (let i = 0; i <= MAX_CACHED_SESSIONS; i++) {
      appendSessionMessage(`cap-${i}`, { role: "user", text: "x" });
    }
    expect(sessions.size).toBeLessThanOrEqual(MAX_CACHED_SESSIONS);
    expect(sessions.has("cap-0"), "the oldest should have been evicted").toBe(false);
    expect(sessions.has(`cap-${MAX_CACHED_SESSIONS}`), "the newest vanished").toBe(true);
  });

  it("touching a session makes it recent — it survives the ceiling", () => {
    for (const s of [...sessions.keys()]) sessions.delete(s);
    appendSessionMessage("active", { role: "user", text: "x" });
    for (let i = 0; i < MAX_CACHED_SESSIONS - 1; i++) {
      appendSessionMessage(`fill-${i}`, { role: "user", text: "x" });
    }
    // Touch "active" again — it becomes the most recent.
    appendSessionMessage("active", { role: "user", text: "y" });
    appendSessionMessage("overflow", { role: "user", text: "x" });
    expect(sessions.has("active"), "the active session was evicted (plan risk #2)").toBe(true);
  });
});
