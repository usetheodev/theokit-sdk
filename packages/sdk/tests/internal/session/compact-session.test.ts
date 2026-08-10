import { describe, expect, it } from "vitest";
import {
  reconstructMessages,
  SessionTranscript,
} from "../../../src/internal/persistence/session-transcript.js";
import {
  COMPACT_SUMMARY_MARKER,
  compactSessionTranscript,
} from "../../../src/internal/session/compact-session.js";
import type { SessionRecord } from "../../../src/types/session-record.js";
import type { SessionStore } from "../../../src/types/session-store.js";

/**
 * M50 T0.2 — the compaction executor (Codex-faithful): replacement = recent user messages verbatim +
 * ONE marker'd summary as role:"user"; append-only persistence; failing summarizer leaves the
 * transcript untouched.
 */

const LOC = { cwd: "/home/u/proj", agentId: "agent-1", model: "openai/gpt-4o-mini" };

function storeWith(initial: SessionRecord[]): SessionStore & { records: SessionRecord[] } {
  const records = [...initial];
  return {
    records,
    async readRecords() {
      return [...records];
    },
    async appendRecords(_agentId: string, delta: readonly SessionRecord[]) {
      records.push(...delta);
    },
  } as unknown as SessionStore & { records: SessionRecord[] };
}

function seedHistory(): SessionRecord[] {
  const t = new SessionTranscript({ cwd: LOC.cwd, sessionId: LOC.agentId, model: LOC.model });
  t.appendUserTurn("my favorite city is Curitiba");
  t.appendAssistantTurn({ text: "noted" });
  t.appendUserTurn("what is the weather like there?");
  t.appendAssistantTurn({ text: `mild in winter. ${"irrelevant detail ".repeat(200)}` });
  return [...t.records()];
}

describe("compactSessionTranscript", () => {
  it("compact_replaces_history_with_recent_users_plus_summary", async () => {
    const store = storeWith(seedHistory());
    const result = await compactSessionTranscript({
      store,
      loc: LOC,
      sessionId: LOC.agentId,
      trigger: "manual",
      summarize: async (msgs) => `summary of ${msgs.length} messages: user lives near Curitiba`,
    });

    const msgs = reconstructMessages(store.records);
    const texts = msgs.map((m) =>
      Array.isArray(m.content)
        ? m.content.map((p) => ("text" in p ? (p as { text: string }).text : "")).join("")
        : String(m.content),
    );
    const joined = texts.join("\n");
    expect(joined).toContain(COMPACT_SUMMARY_MARKER);
    expect(joined).toContain("Curitiba"); // the user message is preserved verbatim
    expect(joined).not.toContain("mild in winter"); // the assistant message is NOT preserved verbatim
    expect(result.postTokens).toBeLessThan(result.preTokens); // REAL reduction with non-trivial history
  });

  it("prior_summaries_filtered_from_preservation", async () => {
    const t = new SessionTranscript({ cwd: LOC.cwd, sessionId: LOC.agentId, model: LOC.model });
    t.appendUserTurn(`${COMPACT_SUMMARY_MARKER}\nold summary that must not duplicate`);
    t.appendUserTurn("current question");
    const store = storeWith([...t.records()]);

    await compactSessionTranscript({
      store,
      loc: LOC,
      sessionId: LOC.agentId,
      trigger: "manual",
      summarize: async () => "a new summary",
    });

    const msgs = reconstructMessages(store.records);
    const texts = msgs.map((m) =>
      Array.isArray(m.content)
        ? m.content.map((p) => ("text" in p ? (p as { text: string }).text : "")).join("")
        : String(m.content),
    );
    const oldSummaryCopies = texts.filter((x) => x.includes("old summary")).length;
    expect(oldSummaryCopies).toBe(0); // the previous summary does NOT enter the new replacement verbatim
    expect(texts.join("\n")).toContain("current question");
  });

  it("summarizer_failure_leaves_transcript_untouched", async () => {
    const initial = seedHistory();
    const store = storeWith(initial);
    const before = JSON.stringify(store.records);

    await expect(
      compactSessionTranscript({
        store,
        loc: LOC,
        sessionId: LOC.agentId,
        trigger: "auto",
        summarize: async () => {
          throw new Error("llm unavailable");
        },
      }),
    ).rejects.toThrow("llm unavailable");

    expect(JSON.stringify(store.records)).toBe(before); // byte-identical — nothing partial
  });

  it("append_only_invariant_holds", async () => {
    const store = storeWith(seedHistory());
    const beforeLen = store.records.length;
    await compactSessionTranscript({
      store,
      loc: LOC,
      sessionId: LOC.agentId,
      trigger: "manual",
      summarize: async () => "a summary",
    });
    expect(store.records.length).toBeGreaterThan(beforeLen); // only grows, never shrinks
    expect(store.records.slice(0, beforeLen).map((r) => r.uuid)).toEqual(
      seedHistory().map(() => expect.any(String)),
    );
  });
});

describe("M50 review fixes — F1 cache invalidation + F9 hardened asserts", () => {
  it("F1_compact_invalidates_in_memory_cache_so_next_send_uses_replacement", async () => {
    const { appendSessionMessage, getSessionMessages, hydrateSession, clearAllSessions } =
      await import("../../../src/internal/session/agent-session.js");
    clearAllSessions();
    const store = storeWith(seedHistory());
    // simulates the live process: hydrated cache + in-process messages
    await hydrateSession(LOC.agentId, { store, cwd: LOC.cwd });
    appendSessionMessage(LOC.agentId, { role: "user", text: "in-memory turn" });
    expect(getSessionMessages(LOC.agentId).length).toBeGreaterThan(0);

    await compactSessionTranscript({
      store,
      loc: LOC,
      sessionId: LOC.agentId,
      trigger: "manual",
      summarize: async () => "a summary",
    });

    // post-compact: the cache was invalidated — the NEXT hydration re-reads disk (replacement)
    expect(getSessionMessages(LOC.agentId)).toEqual([]);
    await hydrateSession(LOC.agentId, { store, cwd: LOC.cwd });
    const rehydrated = getSessionMessages(LOC.agentId);
    const joined = rehydrated.map((m) => m.text).join("\n");
    expect(joined).toContain(COMPACT_SUMMARY_MARKER); // the replacement, not the old history
    expect(joined).not.toContain("mild in winter");
    clearAllSessions();
  });

  it("F9_append_only_prefix_is_byte_immutable", async () => {
    const store = storeWith(seedHistory());
    const beforePrefix = JSON.stringify(store.records);
    await compactSessionTranscript({
      store,
      loc: LOC,
      sessionId: LOC.agentId,
      trigger: "manual",
      summarize: async () => "a summary",
    });
    const afterPrefix = JSON.stringify(store.records.slice(0, JSON.parse(beforePrefix).length));
    expect(afterPrefix).toBe(beforePrefix); // BYTE-identical prefix — real immutability
  });

  it("F9_next_turn_parents_on_the_summary (seam real)", async () => {
    const store = storeWith(seedHistory());
    await compactSessionTranscript({
      store,
      loc: LOC,
      sessionId: LOC.agentId,
      trigger: "manual",
      summarize: async () => "a summary",
    });
    // next turn through the real persistence seam
    const t = SessionTranscript.fromRecords(store.records, {
      cwd: LOC.cwd,
      sessionId: LOC.agentId,
      model: LOC.model,
    });
    t.appendUserTurn("post-compact turn");
    const delta = t.records().slice(store.records.length);
    await store.appendRecords(LOC.agentId, delta);
    const msgs = reconstructMessages(store.records);
    const texts = msgs.map((m) =>
      Array.isArray(m.content)
        ? m.content.map((p) => ("text" in p ? (p as { text: string }).text : "")).join("")
        : String(m.content),
    );
    const joined = texts.join("\n");
    expect(joined).toContain(COMPACT_SUMMARY_MARKER);
    expect(joined).toContain("post-compact turn"); // chained onto the replacement, did not become an orphan
  });
});
