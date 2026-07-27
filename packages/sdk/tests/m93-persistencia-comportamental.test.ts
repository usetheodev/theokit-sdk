/**
 * M93/M1 — o teste comportamental que o gate de forma não era.
 *
 * A primeira versão do M93 verificava a persistência no caminho de erro por regex sobre o fonte, e
 * declarava isso honestamente. A revisão adversarial mediu o custo dessa honestidade: dead-codear a
 * chamada (`void 0 && persistTurnToTranscript(...)`) deixava os 5 testes **verdes**. Um gate que
 * não distingue chamada viva de chamada desligada não é gate.
 *
 * E o teste comportamental ERA escrevível: `SessionStore` é declarado "the pluggable session-store
 * seam. Exactly two methods" (`types/session-store.ts:34`) — a costura DIP existe exatamente para
 * esta substituição, e `safeConversation` só precisa de `run.conversation()`. Declinar de usá-la foi
 * escolha, não limitação.
 */
import { describe, expect, it, vi } from "vitest";
import { runPostRunLifecycle } from "../src/internal/runtime/lifecycle/post-run-lifecycle.js";
import type { Run } from "../src/types/run.js";
import type { SessionRecord, SessionStore } from "../src/types/session-store.js";

/** Store em memória — a porta tem dois métodos, e é para isto que ela existe. */
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

/** Run cujo `wait()` rejeita — o 429 depois de N tool calls — mas que JÁ produziu conversa. */
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
    // `persistTurnToTranscript` só era chamado adiante, num ponto que o erro nunca alcançava.
    expect(store.gravados.length, "nada foi persistido no caminho de erro").toBeGreaterThan(0);
    expect(JSON.stringify(store.gravados)).toContain("oi");
  });

  it("uma falha ao GRAVAR não mascara o erro do provider nem estoura", async () => {
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
