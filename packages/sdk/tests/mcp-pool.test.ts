/**
 * M77 T3.1 — o cliente MCP para de ser recriado a cada turn.
 *
 * ## O custo medido
 *
 * `real-local-run.ts:349` chama `createMcpClient` dentro de `buildMcpMap`, que roda **por run**.
 * Cada `send` refaz spawn + handshake do servidor: 193 / 138 / 134 ms por turn, medidos.
 *
 * ## O que a referência única faz
 *
 * O Codex ancora o `McpConnectionManager` em `SessionServices` (`core/src/state/service.rs:116`) — o
 * mesmo struct cujo campo vizinho leva o comentário *"Session-scoped model client shared across
 * turns"* — e **substitui** o runtime (`service.rs:136`, `self.mcp_runtime.replace(connections)`) em
 * vez de reconstruí-lo. O caminho que constrói e imediatamente destrói
 * (`core/src/connectors.rs:245` … `:334 shutdown()`) é descoberta one-shot de conectores, não o loop
 * de turns; confundir os dois levaria à conclusão oposta.
 *
 * ## Por que a chave inclui o HASH da config
 *
 * `sendOptions.mcpServers` **substitui** `agentOptions.mcpServers` (semântica documentada no docblock
 * de `resolveTools`). Dois runs da mesma sessão podem legitimamente pedir o mesmo NOME de servidor
 * com configuração diferente. Chavear só por `(sessão, nome)` devolveria um cliente conectado ao
 * servidor errado — resposta errada, não erro.
 *
 * ## Por que `'run'` continua o default
 *
 * Manter clientes vivos entre turns muda o modelo de falha: um servidor que morre no meio da sessão
 * agora é um estado alcançável. Cron e one-shot não ganham nada com o pool e pagariam esse risco, então
 * o modo `'session'` é opt-in (plano ADR D3).
 */
import { describe, expect, it } from "vitest";

import { McpClientPool } from "../src/internal/local-agent/mcp-pool.js";

/** Duplo mínimo: só precisa registrar que foi fechado. */
interface ClienteFalso {
  readonly id: number;
  fechado: boolean;
  close: () => void;
}

function fabricaContada(): { criar: () => ClienteFalso; chamadas: () => number } {
  let n = 0;
  return {
    criar: () => {
      n += 1;
      const c: ClienteFalso = { id: n, fechado: false, close: () => (c.fechado = true) };
      return c;
    },
    chamadas: () => n,
  };
}

const CFG = { command: "node", args: ["servidor.js"] };

describe("M77 T3.1 — pool de clientes MCP por sessão", () => {
  it("test_segundo_turn_da_MESMA_sessao_REUSA_o_cliente", () => {
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>();

    const a = pool.acquire("sessao-1", "fs", CFG, f.criar);
    const b = pool.acquire("sessao-1", "fs", CFG, f.criar);

    // Contagem de CAUSA: prova que a fábrica não rodou de novo, não apenas que os objetos batem.
    expect(f.chamadas(), "o segundo turn não pode respawnar o servidor").toBe(1);
    expect(b).toBe(a);
  });

  it("test_sessoes_distintas_NAO_compartilham_cliente", () => {
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>();

    const a = pool.acquire("sessao-1", "fs", CFG, f.criar);
    const b = pool.acquire("sessao-2", "fs", CFG, f.criar);

    // Compartilhar entre sessões vazaria estado de uma conversa para outra.
    expect(f.chamadas()).toBe(2);
    expect(b).not.toBe(a);
  });

  it("test_config_diferente_na_mesma_sessao_cria_OUTRO_cliente", () => {
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>();

    pool.acquire("sessao-1", "fs", CFG, f.criar);
    pool.acquire("sessao-1", "fs", { command: "node", args: ["OUTRO.js"] }, f.criar);

    // Sem o hash na chave, o segundo `acquire` devolveria um cliente ligado ao servidor ERRADO.
    expect(f.chamadas(), "mesmo nome + config diferente ⇒ cliente diferente").toBe(2);
  });

  it("test_CONTRAPROVA_a_ordem_das_chaves_da_config_nao_muda_a_identidade", () => {
    // Sem esta, o hash poderia ser `JSON.stringify` cru — e `{a,b}` vs `{b,a}` produziriam clientes
    // distintos para configurações IDÊNTICAS, respawnando a cada turn e anulando o pool em silêncio.
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>();

    pool.acquire("s", "fs", { command: "node", args: ["x"] }, f.criar);
    pool.acquire("s", "fs", { args: ["x"], command: "node" }, f.criar);

    expect(f.chamadas()).toBe(1);
  });

  it("test_dispose_da_sessao_FECHA_os_clientes_e_libera_a_chave", () => {
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>();

    const a = pool.acquire("sessao-1", "fs", CFG, f.criar);
    const b = pool.acquire("sessao-1", "git", CFG, f.criar);
    pool.disposeSession("sessao-1", (c) => c.close());

    expect(a.fechado, "cliente vazado é processo vazado").toBe(true);
    expect(b.fechado).toBe(true);

    // E a chave sai: um `acquire` seguinte tem de criar de novo, não devolver o fechado.
    pool.acquire("sessao-1", "fs", CFG, f.criar);
    expect(f.chamadas()).toBe(3);
  });

  it("test_dispose_de_uma_sessao_NAO_toca_a_outra", () => {
    // CONTRAPROVA: sem ela, um `disposeSession` que limpasse o Map inteiro passaria no teste acima e
    // derrubaria os servidores de toda conversa concorrente.
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>();

    const a = pool.acquire("sessao-1", "fs", CFG, f.criar);
    const b = pool.acquire("sessao-2", "fs", CFG, f.criar);
    pool.disposeSession("sessao-1", (c) => c.close());

    expect(a.fechado).toBe(true);
    expect(b.fechado, "a sessão vizinha não pode ser derrubada junto").toBe(false);
  });

  it("test_TTL_de_ociosidade_fecha_o_cliente_parado", () => {
    // Relógio INJETADO — `rules/testing.md § 6` proíbe tempo real em teste unitário. Sem o TTL, uma
    // sessão longa que usou um servidor uma vez o mantém vivo até o dispose.
    let agora = 1_000;
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>({ idleTtlMs: 500, now: () => agora });

    const a = pool.acquire("s", "fs", CFG, f.criar);
    agora += 501;
    pool.reapIdle((c) => c.close());

    expect(a.fechado).toBe(true);
    // E a chave saiu: o próximo acquire cria em vez de devolver um cliente morto.
    pool.acquire("s", "fs", CFG, f.criar);
    expect(f.chamadas()).toBe(2);
  });

  it("test_CONTRAPROVA_uso_recente_NAO_e_recolhido", () => {
    // Sem esta, um `reapIdle` que fechasse tudo passaria no teste do TTL e mataria o cliente que
    // acabou de ser usado — o pior resultado possível, pior que não ter pool.
    let agora = 1_000;
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>({ idleTtlMs: 500, now: () => agora });

    const a = pool.acquire("s", "fs", CFG, f.criar);
    agora += 400;
    pool.reapIdle((c) => c.close());

    expect(a.fechado).toBe(false);
  });

  it("test_acquire_RENOVA_a_ociosidade", () => {
    // O TTL é de OCIOSIDADE, não de vida. Um servidor usado a cada turn não pode ser recolhido só
    // porque foi criado há muito tempo.
    let agora = 1_000;
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>({ idleTtlMs: 500, now: () => agora });

    const a = pool.acquire("s", "fs", CFG, f.criar);
    agora += 400;
    pool.acquire("s", "fs", CFG, f.criar); // uso — renova
    agora += 400; // 800 desde a criação, 400 desde o último uso
    pool.reapIdle((c) => c.close());

    expect(a.fechado, "TTL é de ociosidade; o uso renova").toBe(false);
  });
});
