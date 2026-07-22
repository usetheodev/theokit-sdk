import { describe, expect, it } from "vitest";

import {
  autoCompactIfNeeded,
  compactSessionTranscript,
  shouldAutoCompact,
} from "../../../src/internal/session/compact-session.js";
import { reconstructMessages, SessionTranscript } from "../../../src/internal/persistence/session-transcript.js";
import type { SessionRecord } from "../../../src/types/session-record.js";
import type { SessionStore } from "../../../src/types/session-store.js";

/**
 * M50 T0.3 — size-driven auto-compaction (Codex formula: fire at usage_real >= (cw*9)/10,
 * `context_window.rs:74-79` + `openai_models.rs:459-469`) with an anti-cascade guard (never twice
 * without a new turn). Replaces the 50-turn no-summary boundary stub (the amnesia bug).
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

function seed(): SessionRecord[] {
  const t = new SessionTranscript({ cwd: LOC.cwd, sessionId: LOC.agentId, model: LOC.model });
  t.appendUserTurn("contexto longo");
  t.appendAssistantTurn({ text: "resposta" });
  return [...t.records()];
}

describe("shouldAutoCompact (fórmula Codex 0.9×cw)", () => {
  it("auto_compact_fires_at_ninety_percent", () => {
    expect(shouldAutoCompact({ usageTotal: 91_000, contextWindow: 100_000 })).toBe(true);
    expect(shouldAutoCompact({ usageTotal: 90_000, contextWindow: 100_000 })).toBe(true); // >= no limiar
    expect(shouldAutoCompact({ usageTotal: 85_000, contextWindow: 100_000 })).toBe(false);
  });

  it("missing_inputs_never_fire", () => {
    expect(shouldAutoCompact({ usageTotal: undefined, contextWindow: 100_000 })).toBe(false);
    expect(shouldAutoCompact({ usageTotal: 999_999, contextWindow: undefined })).toBe(false);
  });
});

describe("autoCompactIfNeeded (guard anti-cascata)", () => {
  it("compacts_once_and_not_again_without_new_turn", async () => {
    const store = storeWith(seed());
    let calls = 0;
    const opts = {
      store,
      loc: LOC,
      sessionId: LOC.agentId,
      usageTotal: 95_000,
      contextWindow: 100_000,
      turnCount: 7,
      summarize: async () => {
        calls++;
        return "resumo automático";
      },
    };
    expect(await autoCompactIfNeeded(opts)).toBe(true);
    // mesmo turnCount (sem turno novo) → não repete, mesmo acima do limiar
    expect(await autoCompactIfNeeded(opts)).toBe(false);
    expect(calls).toBe(1);
    // turno NOVO acima do limiar → dispara de novo
    expect(await autoCompactIfNeeded({ ...opts, turnCount: 8 })).toBe(true);
    expect(calls).toBe(2);
  });

  it("below_threshold_never_compacts", async () => {
    const store = storeWith(seed());
    let calls = 0;
    const fired = await autoCompactIfNeeded({
      store,
      loc: { ...LOC, agentId: "agent-below" },
      sessionId: "agent-below",
      usageTotal: 10_000,
      contextWindow: 100_000,
      turnCount: 1,
      summarize: async () => {
        calls++;
        return "não deveria";
      },
    });
    expect(fired).toBe(false);
    expect(calls).toBe(0);
    expect(store.records.some((r) => r.subtype === "compact_boundary")).toBe(false);
  });

  it("summarizer_failure_does_not_retry_same_turn_and_leaves_transcript_untouched", async () => {
    const store = storeWith(seed());
    const before = JSON.stringify(store.records);
    let calls = 0;
    const opts = {
      store,
      loc: { ...LOC, agentId: "agent-fail" },
      sessionId: "agent-fail",
      usageTotal: 95_000,
      contextWindow: 100_000,
      turnCount: 3,
      summarize: async () => {
        calls++;
        throw new Error("llm fora");
      },
    };
    expect(await autoCompactIfNeeded(opts)).toBe(false); // falha → não compactou
    expect(await autoCompactIfNeeded(opts)).toBe(false); // mesmo turno → nem tenta de novo
    expect(calls).toBe(1);
    expect(JSON.stringify(store.records)).toBe(before);
  });
});

describe("M50 review F5 — corrida compact × persist (serializada na chain)", () => {
  it("manual_compact_never_interleaves_with_a_turn_write", async () => {
    const { enqueueSessionWrite, clearAllSessions } = await import(
      "../../../src/internal/session/agent-session.js"
    );
    clearAllSessions();
    const store = storeWith(seed());
    const order: string[] = [];
    // compact LENTO enfileirado primeiro…
    const slow = enqueueSessionWrite(LOC.cwd, LOC.agentId, async () => {
      await new Promise((r) => setTimeout(r, 60));
      order.push("compact");
      await compactSessionTranscript({
        store,
        loc: LOC,
        sessionId: LOC.agentId,
        trigger: "manual",
        summarize: async () => "resumo lento",
      });
    });
    // …turno concorrente enfileirado logo depois — DEVE esperar o compact
    const turn = enqueueSessionWrite(LOC.cwd, LOC.agentId, async () => {
      order.push("turn");
      const t = SessionTranscript.fromRecords(store.records, {
        cwd: LOC.cwd,
        sessionId: LOC.agentId,
        model: LOC.model,
      });
      t.appendUserTurn("turno concorrente");
      await store.appendRecords(LOC.agentId, t.records().slice(store.records.length));
    });
    await Promise.all([slow, turn]);
    expect(order).toEqual(["compact", "turn"]); // serializado — nunca intercala
    // e o turno parenteia PÓS-replacement (não vira órfão)
    const msgs = reconstructMessages(store.records);
    const joined = msgs
      .map((m) => (Array.isArray(m.content) ? m.content.map((p) => ("text" in p ? (p as {text:string}).text : "")).join("") : ""))
      .join("\n");
    expect(joined).toContain("turno concorrente");
    expect(joined).toContain("[[theokit:compact-summary]]");
    clearAllSessions();
  });
});

describe("M50 F6 — resolveSummarizerRoute (precedência M4)", () => {
  it("explicit_key_outranks_prefix (sk-or- + openai/model → openrouter, slug completo)", async () => {
    const { resolveSummarizerRoute } = await import(
      "../../../src/internal/session/compact-session.js"
    );
    expect(
      resolveSummarizerRoute({ keyProvider: "openrouter", modelPrefix: "openai", prefixHasProfile: true, envProvider: "openai" }),
    ).toEqual({ provider: "openrouter", fullSlug: true });
  });

  it("oauth_prefix_profile_wins_without_key (openai-chatgpt owns auth)", async () => {
    const { resolveSummarizerRoute } = await import(
      "../../../src/internal/session/compact-session.js"
    );
    expect(
      resolveSummarizerRoute({ keyProvider: undefined, modelPrefix: "openai-chatgpt", prefixHasProfile: true, envProvider: "openrouter" }),
    ).toEqual({ provider: "openai-chatgpt", fullSlug: false });
  });

  it("fleet_prefix_profile_wins_without_key (google resolves own env)", async () => {
    const { resolveSummarizerRoute } = await import(
      "../../../src/internal/session/compact-session.js"
    );
    expect(
      resolveSummarizerRoute({ keyProvider: undefined, modelPrefix: "google", prefixHasProfile: true, envProvider: "openai" }),
    ).toEqual({ provider: "google", fullSlug: false });
  });

  it("env_fallback_when_nothing_else (unknown prefix)", async () => {
    const { resolveSummarizerRoute } = await import(
      "../../../src/internal/session/compact-session.js"
    );
    expect(
      resolveSummarizerRoute({ keyProvider: undefined, modelPrefix: "acme", prefixHasProfile: false, envProvider: "openrouter" }),
    ).toEqual({ provider: "openrouter", fullSlug: true });
  });
});
