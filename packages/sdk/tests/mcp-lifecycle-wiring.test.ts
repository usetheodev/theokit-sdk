/**
 * M77 T3.1 — the pool's WIRING, not its capability.
 *
 * `tests/mcp-pool.test.ts` proves the CLASS reuses, isolates per session and collects on idleness.
 * That does not prove the SYSTEM uses the pool — that was exactly M76's central defect, where
 * `AskBridge` supported per-session scoping and nothing forwarded the `threadId`. The metric passed and the
 * invariant did not.
 *
 * These tests look at the real production site, `buildMcpMap` in `real-local-run.ts`:
 *
 *  - o modo `'session'` chega ao pool;
 *  - the default `'run'` mode does NOT arrive — the counter-proof that stops the pool from silently becoming
 *    everyone's path, changing the failure model of cron and one-shot with nobody asking;
 *  - `dispose()` frees the session's clients, otherwise one child process per server outlives the
 *    agente pelo resto da vida do host.
 */
import { describe, expect, it, vi } from "vitest";

const created: string[] = [];

vi.mock("../src/internal/mcp/client.js", () => ({
  createMcpClient: (name: string) => {
    created.push(name);
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

describe("M77 T3.1 — the pool wiring in buildMcpMap", () => {
  it("test_lifecycle_session_REUSA_entre_dois_turns_da_mesma_sessao", () => {
    created.length = 0;
    const a = _buildMcpMapForTests(opts("agente-1", "session"));
    const b = _buildMcpMapForTests(opts("agente-1", "session"));

    // Counting CAUSE at the real site: proves the second turn did not respawn the server.
    expect(created, "the second turn must not recreate the client").toHaveLength(1);
    expect(b.get("fs")).toBe(a.get("fs"));
    disposeSessionMcpClients("agente-1");
  });

  it("test_CONTRAPROVA_o_default_run_NAO_reusa", () => {
    // A contraprova que importa. Sem ela, fazer o pool valer para todos passaria no teste acima e
    // would change the failure model of cron and one-shot with nobody having asked (plan ADR D3).
    created.length = 0;
    const a = _buildMcpMapForTests(opts("agente-2"));
    const b = _buildMcpMapForTests(opts("agente-2"));

    expect(
      created,
      "without the option, each run has its own client — as it always was",
    ).toHaveLength(2);
    expect(b.get("fs")).not.toBe(a.get("fs"));
  });

  it("test_agentes_distintos_nao_compartilham_mesmo_em_modo_session", () => {
    created.length = 0;
    const a = _buildMcpMapForTests(opts("agente-3", "session"));
    const b = _buildMcpMapForTests(opts("agente-4", "session"));

    expect(created).toHaveLength(2);
    expect(b.get("fs")).not.toBe(a.get("fs"));
    disposeSessionMcpClients("agente-3");
    disposeSessionMcpClients("agente-4");
  });

  it("test_dispose_FECHA_o_cliente_e_o_proximo_turn_cria_de_novo", () => {
    created.length = 0;
    const a = _buildMcpMapForTests(opts("agente-5", "session"));
    const cliente = a.get("fs") as unknown as { close: ReturnType<typeof vi.fn> };

    disposeSessionMcpClients("agente-5");

    // Sem isto, um processo-filho por servidor sobrevive ao agente pelo resto da vida do host.
    expect(cliente.close).toHaveBeenCalled();
    _buildMcpMapForTests(opts("agente-5", "session"));
    expect(created, "the key left the pool — a closed client is not handed back").toHaveLength(2);
    disposeSessionMcpClients("agente-5");
  });
});
