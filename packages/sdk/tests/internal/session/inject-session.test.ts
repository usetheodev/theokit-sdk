import { describe, expect, it } from "vitest";
import {
  reconstructMessages,
  SessionTranscript,
} from "../../../src/internal/persistence/session-transcript.js";
import { injectSessionTurn } from "../../../src/internal/session/inject-session.js";
import type { SessionRecord } from "../../../src/types/session-record.js";
import type { SessionStore } from "../../../src/types/session-store.js";

const LOC = { cwd: "/home/u/proj", agentId: "agent-inj", model: "openai/gpt-4o-mini" };

function storeWith(initial: SessionRecord[]): SessionStore & { records: SessionRecord[] } {
  const records = [...initial];
  return {
    records,
    async readRecords() {
      return [...records];
    },
    async appendRecords(_id: string, delta: readonly SessionRecord[]) {
      records.push(...delta);
    },
  } as unknown as SessionStore & { records: SessionRecord[] };
}

function seed(): SessionRecord[] {
  const t = new SessionTranscript({ cwd: LOC.cwd, sessionId: LOC.agentId, model: LOC.model });
  t.appendUserTurn("hello");
  t.appendAssistantTurn({ text: "oi" });
  return [...t.records()];
}

function texts(records: readonly SessionRecord[]): string {
  return reconstructMessages(records)
    .map((m) =>
      Array.isArray(m.content)
        ? m.content.map((p) => ("text" in p ? (p as { text: string }).text : "")).join("")
        : "",
    )
    .join("\n");
}

describe("injectSessionTurn (M51)", () => {
  it("inject_appends_pair_and_next_reconstruct_sees_it", async () => {
    const store = storeWith(seed());
    await injectSessionTurn({
      store,
      loc: LOC,
      sessionId: LOC.agentId,
      userText: "<user_action><action>review</action><results>[P1] achado</results></user_action>",
      assistantText: "Full review comments: - [P1] achado",
    });
    const joined = texts(store.records);
    expect(joined).toContain("<user_action>");
    expect(joined).toContain("Full review comments");
    expect(joined).toContain("hello"); // prior history intact
  });

  it("inject_invalidates_cache", async () => {
    const { appendSessionMessage, getSessionMessages, hydrateSession, clearAllSessions } =
      await import("../../../src/internal/session/agent-session.js");
    clearAllSessions();
    const store = storeWith(seed());
    await hydrateSession(LOC.agentId, { store, cwd: LOC.cwd });
    appendSessionMessage(LOC.agentId, { role: "user", text: "in memory" });
    await injectSessionTurn({
      store,
      loc: LOC,
      sessionId: LOC.agentId,
      userText: "synthetic pair",
      assistantText: "ack",
    });
    expect(getSessionMessages(LOC.agentId)).toEqual([]); // cache invalidado
    await hydrateSession(LOC.agentId, { store, cwd: LOC.cwd });
    expect(
      getSessionMessages(LOC.agentId)
        .map((m) => m.text)
        .join("\n"),
    ).toContain("synthetic pair");
    clearAllSessions();
  });

  it("inject_serializes_on_write_chain", async () => {
    const { enqueueSessionWrite, clearAllSessions } = await import(
      "../../../src/internal/session/agent-session.js"
    );
    clearAllSessions();
    const store = storeWith(seed());
    const order: string[] = [];
    const slow = enqueueSessionWrite(LOC.cwd, LOC.agentId, async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push("turn");
    });
    const inj = injectSessionTurn({
      store,
      loc: LOC,
      sessionId: LOC.agentId,
      userText: "after",
      assistantText: "ok",
    }).then(() => order.push("inject"));
    await Promise.all([slow, inj]);
    expect(order).toEqual(["turn", "inject"]); // serializado na MESMA chain
    clearAllSessions();
  });
});

describe("M51 review F4 — corrida inject × turno em voo", () => {
  it("hydrate_after_invalidation_replaces_from_disk_even_if_cache_repopulated", async () => {
    const { appendSessionMessage, getSessionMessages, hydrateSession, clearAllSessions } =
      await import("../../../src/internal/session/agent-session.js");
    clearAllSessions();
    const store = storeWith(seed());
    // live session hydrated
    await hydrateSession(LOC.agentId, { store, cwd: LOC.cwd });
    // review termina → inject (invalida)
    await injectSessionTurn({
      store,
      loc: LOC,
      sessionId: LOC.agentId,
      userText: "synthetic-pair",
      assistantText: "findings",
    });
    // an IN-FLIGHT turn completes after the inject -> repopulates the cache with 1 message
    appendSessionMessage(LOC.agentId, {
      role: "assistant",
      text: "answer from the in-flight turn",
    });
    // next send -> hydrate MUST replace from disk (which has EVERYTHING), not pin at 1 message
    await hydrateSession(LOC.agentId, { store, cwd: LOC.cwd });
    const joined = getSessionMessages(LOC.agentId)
      .map((m) => m.text)
      .join("\n");
    expect(joined).toContain("hello"); // original history
    expect(joined).toContain("synthetic-pair"); // injected pair
    clearAllSessions();
  });
});
