import { beforeEach, describe, expect, it } from "vitest";
import {
  appendSessionMessage,
  clearAllSessions,
  flushSessionWrites,
} from "../../../src/internal/runtime/session/agent-session.js";
import type { ConversationStorageAdapter } from "../../../src/types/conversation-storage.js";

/**
 * SE2 — a persistence-side auto-compaction (every COMPACTION_CHECK_INTERVAL=50
 * appends when the adapter implements `compact()`) must invoke the optional
 * `onCompact` callback so the runtime can surface a `compact_boundary` RunEvent.
 * Previously the event was DEAD (declared in the union, never emitted).
 */
describe("agent-session onCompact callback (SE2 compact_boundary)", () => {
  beforeEach(() => clearAllSessions());

  it("fires onCompact once when 50 appends cross the compaction boundary", async () => {
    let compacted = 0;
    let onCompactCalls = 0;
    const adapter = {
      root: "/mem-compact",
      appendMessage: async () => {},
      appendMessages: async () => {},
      getMessages: async () => [],
      compact: async () => {
        compacted += 1;
      },
    } as unknown as ConversationStorageAdapter;

    for (let i = 0; i < 50; i++) {
      appendSessionMessage("agent-compact", { role: "user", text: `m${i}` }, adapter, () => {
        onCompactCalls += 1;
      });
    }
    await flushSessionWrites();

    expect(compacted).toBe(1);
    expect(onCompactCalls).toBe(1);
  });

  it("does not fire onCompact before the boundary", async () => {
    let onCompactCalls = 0;
    const adapter = {
      root: "/mem-compact-2",
      appendMessage: async () => {},
      appendMessages: async () => {},
      getMessages: async () => [],
      compact: async () => {},
    } as unknown as ConversationStorageAdapter;

    for (let i = 0; i < 10; i++) {
      appendSessionMessage("agent-compact-2", { role: "user", text: `m${i}` }, adapter, () => {
        onCompactCalls += 1;
      });
    }
    await flushSessionWrites();
    expect(onCompactCalls).toBe(0);
  });
});
