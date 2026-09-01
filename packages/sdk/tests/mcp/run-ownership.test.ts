/**
 * theokit#155 — the WIRING of MCP client ownership, at the site that actually releases them.
 *
 * `tests/mcp/session-lifecycle-pid.test.ts` proves the composition (pool + initialize + close)
 * behaves as a process. It replays the three production calls by hand, so it cannot prove that
 * `RealLocalRun` makes the same choice. That is precisely the gap the issue found in the previous
 * suite: it drove `_buildMcpMapForTests`, never reached `executeAgentLoop`'s `finally`, and so
 * never observed the `close()` that was undoing the pooling.
 *
 * These tests drive the real run to completion and watch `close`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOptions } from "../../src/types/agent.js";

const closes: string[] = [];

vi.mock("../../src/internal/mcp/client.js", () => ({
  createMcpClient: (name: string) => ({
    name,
    initialize: vi.fn(async () => undefined),
    close: vi.fn(async () => {
      closes.push(name);
    }),
    listTools: vi.fn(async () => []),
    callTool: vi.fn(async () => ({})),
  }),
}));

// The loop itself is out of scope here — what matters is the `finally` that runs after it.
vi.mock("../../src/internal/agent-loop/loop.js", () => ({
  runAgentLoop: vi.fn(async () => ({
    events: [],
    finalStatus: "completed",
    result: "ok",
    conversation: [],
  })),
}));

const { createRealLocalRun, disposeSessionMcpClients } = await import(
  "../../src/internal/local-agent/real-local-run.js"
);

const MCP_SERVERS = { fs: { command: "node", args: ["fs-server.js"] } };

async function runOneTurn(
  agentId: string,
  lifecycle?: AgentOptions["mcpLifecycle"],
): Promise<void> {
  const run = createRealLocalRun({
    agentId,
    model: { id: "claude-sonnet-4-6" },
    message: "hello",
    agentOptions: {
      apiKey: "sk-ant-test-key",
      mcpServers: MCP_SERVERS,
      ...(lifecycle !== undefined ? { mcpLifecycle: lifecycle } : {}),
    },
    sendOptions: {},
    workspaceCwd: process.cwd(),
    hooks: {} as never,
  } as never);
  await run.wait();
}

describe("theokit#155 — who releases the run's MCP clients", () => {
  beforeEach(() => {
    closes.length = 0;
  });

  it("test_session_lifecycle_run_does_NOT_close_the_pooled_client", async () => {
    await runOneTurn("agent-session-1", "session");

    // The turn borrowed the client; the session owns it. Closing here is what killed the child
    // process and made `mcpLifecycle: 'session'` buy nothing.
    expect(closes, "a pooled client must outlive the turn that borrowed it").toEqual([]);

    disposeSessionMcpClients("agent-session-1");
    expect(closes, "the SESSION is what releases it — on dispose").toEqual(["fs"]);
  });

  it("test_COUNTERPROOF_the_default_run_lifecycle_still_closes_its_own_client", async () => {
    // Without this, the fix could have been "never close anything" — a process leak per send.
    await runOneTurn("agent-run-1");

    expect(closes, "an unpooled client dies with the run that created it").toEqual(["fs"]);
  });
});
