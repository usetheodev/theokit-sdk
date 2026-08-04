/**
 * M77 T3.1 — o cliente MCP para de ser recriado a cada turn.
 *
 * ## O custo medido
 *
 * `real-local-run.ts:349` chama `createMcpClient` dentro de `buildMcpMap`, que roda **por run**.
 * Cada `send` refaz spawn + handshake do servidor: 193 / 138 / 134 ms por turn, medidos.
 *
 * ## What the single reference does
 *
 * O Codex ancora o `McpConnectionManager` em `SessionServices` (`core/src/state/service.rs:116`) — o
 * same struct whose neighboring field carries the comment *"Session-scoped model client shared across
 * turns"* — e **substitui** o runtime (`service.rs:136`, `self.mcp_runtime.replace(connections)`) em
 * instead of rebuilding it. The path that builds and immediately destroys
 * (`core/src/connectors.rs:245` ... `:334 shutdown()`) is one-shot connector discovery, not the turn
 * loop; conflating the two would lead to the opposite conclusion.
 *
 * ## Por que a chave inclui o HASH da config
 *
 * `sendOptions.mcpServers` **replaces** `agentOptions.mcpServers` (semantics documented in the docblock
 * of `resolveTools`). Two runs in the same session can legitimately ask for the same server NAME
 * with different configuration. Keying only by `(session, name)` would return a client connected to the
 * wrong server — a wrong answer, not an error.
 *
 * ## Por que `'run'` continua o default
 *
 * Keeping clients alive across turns changes the failure model: a server dying mid-session
 * is now a reachable state. Cron and one-shot gain nothing from the pool and would pay that risk, so
 * the `'session'` mode is opt-in (plan ADR D3).
 */
import { describe, expect, it } from "vitest";

import { McpClientPool } from "../src/internal/local-agent/mcp-pool.js";

/** Minimal double: it only needs to record that it was closed. */
interface ClienteFalso {
  readonly id: number;
  closed: boolean;
  close: () => void;
}

function fabricaContada(): { criar: () => ClienteFalso; calls: () => number } {
  let n = 0;
  return {
    criar: () => {
      n += 1;
      const c: ClienteFalso = { id: n, closed: false, close: () => (c.closed = true) };
      return c;
    },
    calls: () => n,
  };
}

const CFG = { command: "node", args: ["servidor.js"] };

describe("M77 T3.1 — per-session MCP client pool", () => {
  it("test_segundo_turn_da_MESMA_sessao_REUSA_o_cliente", () => {
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>();

    const a = pool.acquire("sessao-1", "fs", CFG, f.criar);
    const b = pool.acquire("sessao-1", "fs", CFG, f.criar);

    // Counting CAUSE: it proves the factory did not run again, not merely that the objects match.
    expect(f.calls(), "the second turn must not respawn the server").toBe(1);
    expect(b).toBe(a);
  });

  it("test_sessoes_distintas_NAO_compartilham_cliente", () => {
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>();

    const a = pool.acquire("sessao-1", "fs", CFG, f.criar);
    const b = pool.acquire("sessao-2", "fs", CFG, f.criar);

    // Sharing across sessions would leak state from one conversation into another.
    expect(f.calls()).toBe(2);
    expect(b).not.toBe(a);
  });

  it("test_config_diferente_na_mesma_sessao_cria_OUTRO_cliente", () => {
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>();

    pool.acquire("sessao-1", "fs", CFG, f.criar);
    pool.acquire("sessao-1", "fs", { command: "node", args: ["OUTRO.js"] }, f.criar);

    // Sem o hash na chave, o segundo `acquire` devolveria um cliente ligado ao servidor ERRADO.
    expect(f.calls(), "mesmo nome + config diferente ⇒ cliente diferente").toBe(2);
  });

  it("test_CONTRAPROVA_a_ordem_das_chaves_da_config_nao_muda_a_identidade", () => {
    // Sem esta, o hash poderia ser `JSON.stringify` cru — e `{a,b}` vs `{b,a}` produziriam clientes
    // distinct for IDENTICAL configurations, respawning every turn and silently nullifying the pool.
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>();

    pool.acquire("s", "fs", { command: "node", args: ["x"] }, f.criar);
    pool.acquire("s", "fs", { args: ["x"], command: "node" }, f.criar);

    expect(f.calls()).toBe(1);
  });

  it("test_dispose_da_sessao_FECHA_os_clientes_e_libera_a_chave", () => {
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>();

    const a = pool.acquire("sessao-1", "fs", CFG, f.criar);
    const b = pool.acquire("sessao-1", "git", CFG, f.criar);
    pool.disposeSession("sessao-1", (c) => c.close());

    expect(a.closed, "a leaked client is a leaked process").toBe(true);
    expect(b.closed).toBe(true);

    // And the key goes away: a subsequent `acquire` must create anew, not return the closed one.
    pool.acquire("sessao-1", "fs", CFG, f.criar);
    expect(f.calls()).toBe(3);
  });

  it("test_dispose_de_uma_sessao_NAO_toca_a_outra", () => {
    // CONTRAPROVA: sem ela, um `disposeSession` que limpasse o Map inteiro passaria no teste acima e
    // derrubaria os servidores de toda conversa concorrente.
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>();

    const a = pool.acquire("sessao-1", "fs", CFG, f.criar);
    const b = pool.acquire("sessao-2", "fs", CFG, f.criar);
    pool.disposeSession("sessao-1", (c) => c.close());

    expect(a.closed).toBe(true);
    expect(b.closed, "the neighboring session must not be torn down with it").toBe(false);
  });

  it("test_TTL_de_ociosidade_fecha_o_cliente_parado", () => {
    // INJECTED clock — `rules/testing.md` § 6 forbids real time in a unit test. Without the TTL, a
    // long session that used a server once keeps it alive until dispose.
    let now = 1_000;
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>({ idleTtlMs: 500, now: () => now });

    const a = pool.acquire("s", "fs", CFG, f.criar);
    now += 501;
    pool.reapIdle((c) => c.close());

    expect(a.closed).toBe(true);
    // And the key is gone: the next acquire creates instead of returning a dead client.
    pool.acquire("s", "fs", CFG, f.criar);
    expect(f.calls()).toBe(2);
  });

  it("test_CONTRAPROVA_uso_recente_NAO_e_recolhido", () => {
    // Sem esta, um `reapIdle` que fechasse tudo passaria no teste do TTL e mataria o cliente que
    // was just used — the worst possible outcome, worse than having no pool.
    let now = 1_000;
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>({ idleTtlMs: 500, now: () => now });

    const a = pool.acquire("s", "fs", CFG, f.criar);
    now += 400;
    pool.reapIdle((c) => c.close());

    expect(a.closed).toBe(false);
  });

  it("test_acquire_RENOVA_a_ociosidade", () => {
    // The TTL is about IDLENESS, not lifetime. A server used every turn must not be collected just
    // because it was created long ago.
    let now = 1_000;
    const f = fabricaContada();
    const pool = new McpClientPool<ClienteFalso>({ idleTtlMs: 500, now: () => now });

    const a = pool.acquire("s", "fs", CFG, f.criar);
    now += 400;
    pool.acquire("s", "fs", CFG, f.criar); // uso — renova
    now += 400; // 800 since creation, 400 since last use
    pool.reapIdle((c) => c.close());

    expect(a.closed, "the TTL is about idleness; use renews it").toBe(false);
  });
});
