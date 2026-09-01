/**
 * theokit#155 (RED-first) — `mcpLifecycle: 'session'` must survive the TURN, as a PROCESS.
 *
 * The pre-existing `mcp/lifecycle-wiring.test.ts` counted client OBJECTS and concluded the server
 * had not respawned. Object identity is not process identity: the pool did hand back the same
 * object, while the previous turn had already SIGTERM'd its child and the next `initialize()`
 * spawned a fresh one. The knob was reachable, documented, tested — and bought 0 ms.
 *
 * So this file counts PIDs, and pairs every assertion with the negative control that makes it
 * non-vacuous: remove the guard and the count changes.
 */
import { describe, expect, it } from "vitest";
import { McpClientPool } from "../../src/internal/local-agent/mcp-pool.js";
import { createMcpClient, type McpClient } from "../../src/internal/mcp/client.js";

/** A stdio MCP server that answers every request and stays alive. */
const SERVER = `
  let buf = "";
  process.stdin.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } }) + "\\n");
    }
  });
`;

const CFG = { type: "stdio" as const, command: "node", args: ["-e", SERVER] };

/** The child PID of a stdio client — the only evidence that distinguishes reuse from respawn. */
const pidOf = (client: McpClient): number | undefined =>
  (client as unknown as { child?: { pid?: number } }).child?.pid;

/**
 * Replays the three production calls of one turn under `mcpLifecycle: 'session'`:
 * `buildMcpMap` acquires from the pool, `initializeMcp` handshakes, and — when the run owns the
 * client — `executeAgentLoop`'s `finally` closes it.
 */
async function turns(count: number, runOwnsClient: boolean): Promise<Set<number | undefined>> {
  const pool = new McpClientPool<McpClient>();
  const pids = new Set<number | undefined>();
  for (let turn = 0; turn < count; turn += 1) {
    const client = pool.acquire("agent-1", "srv", CFG, () => createMcpClient("srv", CFG));
    await client.initialize();
    pids.add(pidOf(client));
    if (runOwnsClient) await client.close().catch(() => undefined);
  }
  pool.disposeSession("agent-1", (c) => void c.close());
  return pids;
}

describe("theokit#155 — a pooled MCP server survives the turn as a process", () => {
  it("test_session_lifecycle_keeps_ONE_child_process_across_three_turns", async () => {
    const pids = await turns(3, /* runOwnsClient */ false);

    // The whole point of the option: no spawn + handshake before the first token of turns 2 and 3.
    expect(pids.size, "the session owns the child — three turns, one process").toBe(1);
    expect([...pids][0]).toBeTypeOf("number");
  }, 20_000);

  it("test_COUNTERPROOF_closing_per_turn_is_what_produces_the_respawn", async () => {
    // The negative control from the issue. Without it, the assertion above could pass for the wrong
    // reason (e.g. a client that never spawns at all) and prove nothing.
    const pids = await turns(3, /* runOwnsClient */ true);

    expect(pids.size, "a closed child cannot be reused — this is the defect's cause").toBe(3);
  }, 20_000);

  it("test_initialize_is_idempotent_while_the_child_is_live", async () => {
    // Not closing is not enough on its own: `initializeMcp` runs EVERY turn, and an unconditional
    // `spawnChild()` would replace the live child, orphaning the first process and paying the spawn
    // cost anyway. Idempotence is the other half of the fix.
    const client = createMcpClient("srv", CFG);
    await client.initialize();
    const first = pidOf(client);
    await client.initialize();

    expect(pidOf(client), "a second initialize must not replace a live child").toBe(first);
    await client.close();
  }, 20_000);

  it("test_initialize_still_spawns_again_after_close", async () => {
    // Idempotence must not wedge the client: once closed, the next initialize is a real spawn.
    const client = createMcpClient("srv", CFG);
    await client.initialize();
    const first = pidOf(client);
    await client.close();
    await client.initialize();

    expect(pidOf(client)).toBeTypeOf("number");
    expect(pidOf(client), "close released the child — initialize must spawn a new one").not.toBe(
      first,
    );
    await client.close();
  }, 20_000);
});
