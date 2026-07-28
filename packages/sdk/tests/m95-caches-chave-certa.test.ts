/**
 * M95 — HIGH-1 e HIGH-2 da revisão adversarial: os `delete` usavam a chave errada.
 *
 * Três dos quatro mapas são chaveados por `transcriptKey(cwd, agentId)`; só `sessions` usa
 * `agentId` cru. `descartarSessao` apagava dois deles pelo `agentId`, então **nunca** apagava nada
 * — e o teste anterior não pegava porque só afirmava que a SEGUNDA chamada devolve 0, o que é
 * verdade mesmo se a primeira não apagar nada.
 *
 * Pior, o teto LRU evicta `sessions` pelo `agentId` e deixava `hydratedKeys` para trás. Como
 * `hydrateSession` retorna cedo quando a chave está lá, uma sessão evictada voltava **vazia** em
 * vez de reidratar do disco: amnésia silenciosa, e regressão NOVA do M95 — antes nada evictava.
 */
import { describe, expect, it } from "vitest";
import {
  appendSessionMessage,
  descartarSessao,
  flushSessionWrites,
  persistTurnToTranscript,
  TETO_DE_SESSOES_EM_CACHE,
} from "../src/internal/session/agent-session.js";
import { hydratedKeys, sessions, transcriptKey } from "../src/internal/session/session-cache.js";
import type { SessionRecord, SessionStore } from "../src/types/session-store.js";

const CWD = "/algum/cwd";

/** Store que aceita tudo — o alvo aqui são as caches, não a persistência. */
const storeInerte = (): SessionStore => ({
  readRecords: async (): Promise<SessionRecord[]> => [],
  appendRecords: async (): Promise<void> => undefined,
});

function limpar(): void {
  for (const k of [...sessions.keys()]) sessions.delete(k);
  for (const k of [...hydratedKeys]) hydratedKeys.delete(k);
}

describe("M95/HIGH-1 — descartarSessao apaga pela chave que a escrita usou", () => {
  it("apaga recordCounts depois do flush", async () => {
    limpar();
    // Populado pelo caminho REAL — `persistTurnToTranscript` é quem escreve, e usa
    // `transcriptKey(cwd, agentId)`. Popular à mão testaria o duble.
    persistTurnToTranscript(storeInerte(), { cwd: CWD, agentId: "ag", model: "m" }, "ag", {
      userText: "oi",
      conversation: [],
    });
    await flushSessionWrites();
    hydratedKeys.add(transcriptKey(CWD, "ag"));
    // 2 = hydratedKeys + recordCounts. `pendingWrites` já saiu no flush, por desenho.
    expect(descartarSessao(CWD, "ag"), "recordCounts não foi apagado").toBe(2);
  });

  it("apaga pendingWrites ANTES do flush — o momento em que ele existe", () => {
    limpar();
    persistTurnToTranscript(storeInerte(), { cwd: CWD, agentId: "ag2", model: "m" }, "ag2", {
      userText: "oi",
      conversation: [],
    });
    hydratedKeys.add(transcriptKey(CWD, "ag2"));
    // 2 = hydratedKeys + pendingWrites. `recordCounts` só é escrito quando a gravação conclui.
    expect(descartarSessao(CWD, "ag2"), "pendingWrites não foi apagado").toBe(2);
  });

  it("um segundo descarte é no-op", () => {
    limpar();
    hydratedKeys.add(transcriptKey(CWD, "ag3"));
    expect(descartarSessao(CWD, "ag3")).toBe(1);
    expect(descartarSessao(CWD, "ag3")).toBe(0);
  });
});

describe("M95/HIGH-2 — o teto não deixa hydratedKeys órfã", () => {
  it("evictar uma sessão pelo teto também tira a marca de hidratação", () => {
    limpar();
    // Enche até o teto, marcando cada uma como hidratada.
    for (let i = 0; i <= TETO_DE_SESSOES_EM_CACHE; i++) {
      appendSessionMessage(`t-${i}`, { role: "user", text: "x" });
      hydratedKeys.add(transcriptKey(CWD, `t-${i}`));
    }
    expect(sessions.has("t-0"), "a mais antiga não foi evictada").toBe(false);
    expect(
      hydratedKeys.has(transcriptKey(CWD, "t-0")),
      "a marca de hidratação ficou órfã — a sessão volta VAZIA em vez de reidratar do disco",
    ).toBe(false);
  });
});
