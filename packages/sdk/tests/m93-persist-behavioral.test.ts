/**
 * M93/M1 — the behavioral test the shape gate was not.
 *
 * M93's first version checked error-path persistence by regex over the source, and
 * declared that honestly. Adversarial review measured the cost of that honesty: dead-coding the
 * chamada (`void 0 && persistTurnToTranscript(...)`) deixava os 5 testes **verdes**. Um gate que
 * cannot tell a live call from a disabled one is not a gate.
 *
 * And the behavioral test WAS writable: `SessionStore` is declared "the pluggable session-store
 * seam. Exactly two methods" (`types/session-store.ts:34`) — a costura DIP existe exatamente para
 * this substitution, and `safeConversation` only needs `run.conversation()`. Declining to use it was a
 * choice, not a limitation.
 */
import { describe, expect, it, vi } from "vitest";
import { runPostRunLifecycle } from "../src/internal/runtime/lifecycle/post-run-lifecycle.js";
import type { Run } from "../src/types/run.js";
import type { SessionRecord, SessionStore } from "../src/types/session-store.js";

/** In-memory store — the port has two methods, and this is what it exists for. */
function storeEmMemoria(): SessionStore & { gravados: SessionRecord[] } {
  const gravados: SessionRecord[] = [];
  return {
    gravados,
    readRecords: async () => gravados,
    appendRecords: async (_id: string, records: SessionRecord[]) => {
      gravados.push(...records);
    },
  } as SessionStore & { gravados: SessionRecord[] };
}

/** A run whose `wait()` rejects — the 429 after N tool calls — but which HAS already produced conversation. */
function runQueFalhaComParcial(parcial: unknown[]): Run {
  return {
    wait: async () => {
      throw new Error("429 rate limited depois de 8 tool calls");
    },
    conversation: async () => parcial,
  } as unknown as Run;
}

const inertes = {
  hooksExecutor: { run: async () => undefined } as never,
  memoryGlue: { onTurn: async () => undefined } as never,
};

describe("M93/M1 — o caminho de erro persiste de verdade", () => {
  it("um turno que falha DEIXA o parcial no store", async () => {
    const store = storeEmMemoria();
    await runPostRunLifecycle({
      run: runQueFalhaComParcial([
        { role: "assistant", content: [{ type: "text", text: "parcial" }] },
      ]),
      userText: "oi",
      agentId: "ag-1",
      workspaceCwd: process.cwd(),
      sessionStore: store,
      model: "claude-sonnet-4-5",
      ...inertes,
    });
    // Antes do M93 isto era 0: `flushSessionWrites` drenava um conjunto vazio, porque
    // `persistTurnToTranscript` was only called later, at a point the error never reached.
    expect(store.gravados.length, "nada foi persistido no caminho de erro").toBeGreaterThan(0);
    expect(JSON.stringify(store.gravados)).toContain("oi");
  });

  it("a WRITE failure neither masks the provider error nor escapes", async () => {
    const storeQuebrado = {
      readRecords: async () => [],
      appendRecords: async () => {
        throw new Error("disco cheio");
      },
    } as unknown as SessionStore;
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await expect(
        runPostRunLifecycle({
          run: runQueFalhaComParcial([{ role: "assistant", content: [] }]),
          userText: "oi",
          agentId: "ag-2",
          workspaceCwd: process.cwd(),
          sessionStore: storeQuebrado,
          model: "claude-sonnet-4-5",
          ...inertes,
        }),
      ).resolves.toBeUndefined();
    } finally {
      stderr.mockRestore();
    }
  });
});
