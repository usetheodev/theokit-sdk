/**
 * M77 T3.1 — a FIAÇÃO do pool, não a capacidade dele.
 *
 * `tests/mcp-pool.test.ts` prova que a CLASSE reusa, isola por sessão e recolhe por ociosidade.
 * Isso não prova que o SISTEMA usa o pool — foi exatamente esse o defeito central do M76, onde
 * `AskBridge` suportava escopo por sessão e nada encaminhava o `threadId`. A métrica passava e o
 * invariante não.
 *
 * Estes testes olham para o sítio real de produção, `buildMcpMap` em `real-local-run.ts`:
 *
 *  - o modo `'session'` chega ao pool;
 *  - o modo default `'run'` NÃO chega — a contraprova que impede o pool de virar o caminho de todo
 *    mundo em silêncio, mudando o modelo de falha de cron e one-shot sem ninguém pedir;
 *  - `dispose()` libera os clientes da sessão, senão um processo-filho por servidor sobrevive ao
 *    agente pelo resto da vida do host.
 */
import { describe, expect, it, vi } from "vitest";

const criados: string[] = [];

vi.mock("../src/internal/mcp/client.js", () => ({
  createMcpClient: (name: string) => {
    criados.push(name);
    return {
      name,
      close: vi.fn(),
      initialize: vi.fn(async () => undefined),
      listTools: vi.fn(async () => []),
      callTool: vi.fn(async () => ({})),
    };
  },
}));

const { _buildMcpMapForTests, disposeSessionMcpClients } = await import(
  "../src/internal/local-agent/real-local-run.js"
);

const CFG = { fs: { command: "node", args: ["fs-server.js"] } };

const opts = (agentId: string, lifecycle?: "run" | "session"): never =>
  ({
    agentId,
    sendOptions: {},
    agentOptions: {
      mcpServers: CFG,
      ...(lifecycle !== undefined ? { mcpLifecycle: lifecycle } : {}),
    },
  }) as never;

describe("M77 T3.1 — a fiação do pool em buildMcpMap", () => {
  it("test_lifecycle_session_REUSA_entre_dois_turns_da_mesma_sessao", () => {
    criados.length = 0;
    const a = _buildMcpMapForTests(opts("agente-1", "session"));
    const b = _buildMcpMapForTests(opts("agente-1", "session"));

    // Contagem de CAUSA no sítio real: prova que o segundo turn não respawnou o servidor.
    expect(criados, "o segundo turn não pode recriar o cliente").toHaveLength(1);
    expect(b.get("fs")).toBe(a.get("fs"));
    disposeSessionMcpClients("agente-1");
  });

  it("test_CONTRAPROVA_o_default_run_NAO_reusa", () => {
    // A contraprova que importa. Sem ela, fazer o pool valer para todos passaria no teste acima e
    // mudaria o modelo de falha de cron e one-shot sem ninguém ter pedido (plano ADR D3).
    criados.length = 0;
    const a = _buildMcpMapForTests(opts("agente-2"));
    const b = _buildMcpMapForTests(opts("agente-2"));

    expect(criados, "sem a opção, cada run tem seu cliente — como sempre foi").toHaveLength(2);
    expect(b.get("fs")).not.toBe(a.get("fs"));
  });

  it("test_agentes_distintos_nao_compartilham_mesmo_em_modo_session", () => {
    criados.length = 0;
    const a = _buildMcpMapForTests(opts("agente-3", "session"));
    const b = _buildMcpMapForTests(opts("agente-4", "session"));

    expect(criados).toHaveLength(2);
    expect(b.get("fs")).not.toBe(a.get("fs"));
    disposeSessionMcpClients("agente-3");
    disposeSessionMcpClients("agente-4");
  });

  it("test_dispose_FECHA_o_cliente_e_o_proximo_turn_cria_de_novo", () => {
    criados.length = 0;
    const a = _buildMcpMapForTests(opts("agente-5", "session"));
    const cliente = a.get("fs") as unknown as { close: ReturnType<typeof vi.fn> };

    disposeSessionMcpClients("agente-5");

    // Sem isto, um processo-filho por servidor sobrevive ao agente pelo resto da vida do host.
    expect(cliente.close).toHaveBeenCalled();
    _buildMcpMapForTests(opts("agente-5", "session"));
    expect(criados, "a chave saiu do pool — não se devolve um cliente fechado").toHaveLength(2);
    disposeSessionMcpClients("agente-5");
  });
});
