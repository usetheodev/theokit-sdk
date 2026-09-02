/**
 * M77 T3.1 — the pool's WIRING, not its capability.
 *
 * `tests/mcp/pool.test.ts` proves the CLASS reuses, isolates per session and collects on idleness.
 * That does not prove the SYSTEM uses the pool — that was exactly M76's central defect, where
 * `AskBridge` supported per-session scoping and nothing forwarded the `threadId`. The metric passed and the
 * invariant did not.
 *
 * These tests look at the real production site, `buildMcpMap` in `real-local-run.ts`:
 *
 *  - the `'session'` mode reaches the pool;
 *  - the default `'run'` mode does NOT arrive — the counter-proof that stops the pool from silently becoming
 *    everyone's path, changing the failure model of cron and one-shot with nobody asking;
 *  - `dispose()` frees the session's clients, otherwise one child process per server outlives the
 *    agent for the rest of the host's life.
 */
import { describe, expect, it, vi } from "vitest";

const created: string[] = [];

vi.mock("../../src/internal/mcp/client.js", () => ({
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
  "../../src/internal/local-agent/real-local-run-mcp.js"
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
  it("test_lifecycle_session_REUSES_across_two_turns_of_the_same_session", () => {
    created.length = 0;
    const a = _buildMcpMapForTests(opts("agent-1", "session"));
    const b = _buildMcpMapForTests(opts("agent-1", "session"));

    // Counting CAUSE at the real site: proves the second turn did not respawn the server.
    expect(created, "the second turn must not recreate the client").toHaveLength(1);
    expect(b.get("fs")).toBe(a.get("fs"));
    disposeSessionMcpClients("agent-1");
  });

  it("test_COUNTERPROOF_the_default_run_does_NOT_reuse", () => {
    // The counter-proof that matters. Without it, making the pool apply to everyone would pass the test above and
    // would change the failure model of cron and one-shot with nobody having asked (plan ADR D3).
    created.length = 0;
    const a = _buildMcpMapForTests(opts("agent-2"));
    const b = _buildMcpMapForTests(opts("agent-2"));

    expect(
      created,
      "without the option, each run has its own client — as it always was",
    ).toHaveLength(2);
    expect(b.get("fs")).not.toBe(a.get("fs"));
  });

  it("test_distinct_agents_do_not_share_even_in_session_mode", () => {
    created.length = 0;
    const a = _buildMcpMapForTests(opts("agent-3", "session"));
    const b = _buildMcpMapForTests(opts("agent-4", "session"));

    expect(created).toHaveLength(2);
    expect(b.get("fs")).not.toBe(a.get("fs"));
    disposeSessionMcpClients("agent-3");
    disposeSessionMcpClients("agent-4");
  });

  it("test_dispose_CLOSES_the_client_and_the_next_turn_creates_it_again", () => {
    created.length = 0;
    const a = _buildMcpMapForTests(opts("agent-5", "session"));
    const client = a.get("fs") as unknown as { close: ReturnType<typeof vi.fn> };

    disposeSessionMcpClients("agent-5");

    // Without this, one child process per server outlives the agent for the rest of the host's life.
    expect(client.close).toHaveBeenCalled();
    _buildMcpMapForTests(opts("agent-5", "session"));
    expect(created, "the key left the pool — a closed client is not handed back").toHaveLength(2);
    disposeSessionMcpClients("agent-5");
  });
});
