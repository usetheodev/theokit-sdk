/**
 * M95 Fase 3 — as quatro caches de nível de módulo ganham teto e eviction.
 *
 * `agent-session.ts` e `session-cache.ts` mantêm quatro mapas de processo — `sessions`,
 * `hydratedKeys`, `pendingWrites`, `recordCounts` — e nenhum apaga entrada por id ao fim da vida
 * do agente. Medido: `invalidateSessionCache` limpa **dois** (`sessions`, `hydratedKeys`); os
 * outros dois nunca são tocados por id. Num processo de vida longa que roda muitas sessões, isso é
 * crescimento sem dono.
 */
import { describe, expect, it } from "vitest";
import {
  appendSessionMessage,
  descartarSessao,
  TETO_DE_SESSOES_EM_CACHE,
} from "../src/internal/session/agent-session.js";
import { hydratedKeys, sessions, transcriptKey } from "../src/internal/session/session-cache.js";

const CWD = "/algum/cwd";

describe("M95 — descartarSessao apaga as QUATRO entradas", () => {
  it("apaga hydratedKeys mas PRESERVA sessions — há leitor legítimo pós-dispose", () => {
    // `sessions` é a conversa legível, e o golden `two-concurrent-sends-serialize` a lê DEPOIS do
    // `agent.dispose()`. Apagá-la aqui devolvia lista vazia. Quem a limita é o teto LRU.
    appendSessionMessage("ag-x", { role: "user", text: "oi" });
    hydratedKeys.add(transcriptKey(CWD, "ag-x"));
    descartarSessao(CWD, "ag-x");
    expect(sessions.has("ag-x"), "a conversa sumiu — o leitor pós-dispose quebra").toBe(true);
    expect(hydratedKeys.has(transcriptKey(CWD, "ag-x"))).toBe(false);
  });

  it("apaga também pendingWrites e recordCounts — os dois que invalidateSessionCache não tocava", () => {
    appendSessionMessage("ag-y", { role: "user", text: "oi" });
    descartarSessao(CWD, "ag-y");
    // Sem acesso direto aos mapas privados, a prova é a contagem viva do módulo.
    expect(descartarSessao(CWD, "ag-y")).toBe(0);
  });
});

describe("M95 — teto de sessões em cache", () => {
  it("evicta a MENOS recente ao cruzar o teto", () => {
    for (const s of [...sessions.keys()]) sessions.delete(s);
    for (let i = 0; i <= TETO_DE_SESSOES_EM_CACHE; i++) {
      appendSessionMessage(`teto-${i}`, { role: "user", text: "x" });
    }
    expect(sessions.size).toBeLessThanOrEqual(TETO_DE_SESSOES_EM_CACHE);
    expect(sessions.has("teto-0"), "a mais antiga deveria ter sido evictada").toBe(false);
    expect(sessions.has(`teto-${TETO_DE_SESSOES_EM_CACHE}`), "a mais nova sumiu").toBe(true);
  });

  it("tocar uma sessão a torna recente — ela sobrevive ao teto", () => {
    for (const s of [...sessions.keys()]) sessions.delete(s);
    appendSessionMessage("ativa", { role: "user", text: "x" });
    for (let i = 0; i < TETO_DE_SESSOES_EM_CACHE - 1; i++) {
      appendSessionMessage(`enche-${i}`, { role: "user", text: "x" });
    }
    // Toca a "ativa" de novo — passa a ser a mais recente.
    appendSessionMessage("ativa", { role: "user", text: "y" });
    appendSessionMessage("estoura", { role: "user", text: "x" });
    expect(sessions.has("ativa"), "a sessão ativa foi evictada (risco #2 do plano)").toBe(true);
  });
});
