/**
 * theokit#155 — a failed handshake must leave the client retryable. CHARACTERIZATION, not regression.
 *
 * `/review` raised this as a defect: `spawnChild()` assigns `this.child` before the handshake can
 * throw, so guarding `initialize()` on `this.child !== undefined` looked like it would latch a
 * spawned-but-uninitialized client shut — and under `mcpLifecycle: 'session'` the run no longer
 * closes it, so no later turn would retry.
 *
 * I measured it instead of assuming, and **the wedge does not exist**. On the timeout path the
 * client marks itself `dropped` and clears `this.child`, so the next `initialize()` re-spawns:
 *
 *     handshake: REJECTED code= mcp_timeout
 *     child after failed handshake: undefined -> SELF-HEALS
 *     dropped: true  initialized: false
 *
 * The proposed fix (an `initialized` flag + releasing the child on throw) was therefore reverted
 * under the parsimony ladder's first rung — it repaired a state that is unreachable, and no test
 * could distinguish it: the original code passes every assertion below.
 *
 * These tests stay because the BEHAVIOUR is worth pinning. Nothing structural prevents a future
 * change from introducing the latch for real, and this file fails the moment one does.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { createMcpClient, type McpClient } from "../../src/internal/mcp/client.js";
import { removeTempDirRobustSync } from "../helpers/temp-workspace.js";

const opened: McpClient[] = [];

afterEach(async () => {
  // Real child processes: release them even when an assertion throws mid-test.
  await Promise.all(opened.splice(0).map((c) => c.close().catch(() => undefined)));
});

function track(client: McpClient): McpClient {
  opened.push(client);
  return client;
}

const pidOf = (client: McpClient): number | undefined =>
  (client as unknown as { child?: { pid?: number } }).child?.pid;

/**
 * A server whose FIRST spawn STAYS ALIVE and never answers — a handshake TIMEOUT.
 *
 * The distinction matters and cost me a vacuous test: a server that `process.exit()`s fires the
 * child's own `exit` handler, which clears `this.child` and marks the client dropped. That case
 * self-heals under the OLD guard too. The wedge needs a child that is still alive while the
 * handshake fails, so `this.child` stays set and `if (this.child !== undefined) return` latches.
 * Later spawns answer normally, so a genuine retry is observable.
 */
function silentThenHealthyServer(counterFile: string): string {
  return `
    const fs = require("node:fs");
    let n = 0;
    try { n = parseInt(fs.readFileSync(${JSON.stringify("COUNTER")}, "utf8"), 10) || 0; } catch {}
    fs.writeFileSync(${JSON.stringify("COUNTER")}, String(n + 1));
    let buf = "";
    process.stdin.on("data", (d) => {
      if (n === 0) return;                      // first spawn: alive, but deaf — handshake times out
      buf += d;
      let i;
      while ((i = buf.indexOf("\\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } }) + "\\n");
      }
    });
    setInterval(() => {}, 1 << 30);             // keep the process alive
  `
    .split("COUNTER")
    .join(counterFile);
}

const ALIVE_SERVER = `
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

describe("theokit#155 — initialize() after a failed handshake", () => {
  it("test_a_second_turn_RETRIES_when_the_first_handshake_failed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-handshake-"));
    const __dirCleanup1 = dir;
    onTestFinished(() => {
      removeTempDirRobustSync(__dirCleanup1);
    });
    const counterFile = join(dir, "count");
    writeFileSync(counterFile, "0");
    const cfg = {
      type: "stdio" as const,
      command: "node",
      args: ["-e", silentThenHealthyServer(counterFile)],
      requestTimeoutMs: 400, // short: the first handshake must TIME OUT, not hang the suite
    };
    // The pooled client: the SAME object is handed to both turns, as under `mcpLifecycle: 'session'`.
    const client = track(createMcpClient("flaky", cfg));

    await expect(client.initialize(), "turn 1 handshake fails").rejects.toBeDefined();

    // The property under test: a second turn genuinely re-spawns and completes the handshake.
    // (Today this holds because the timeout path clears `this.child`; the assertion does not depend
    // on WHICH mechanism delivers it, only that the session is not left with a dead server.)
    await expect(client.initialize(), "turn 2 must genuinely retry").resolves.toBeUndefined();
    expect(await client.listTools()).toEqual([]);
  }, 20_000);

  it("test_COUNTERPROOF_a_successful_handshake_is_still_not_repeated", async () => {
    // The idempotence theokit#155 shipped. Without this assertion, "make failures retryable" could
    // be implemented as "always re-spawn", reinstating the 146 ms per turn the issue measured.
    const cfg = { type: "stdio" as const, command: "node", args: ["-e", ALIVE_SERVER] };
    const client = track(createMcpClient("srv", cfg));

    await client.initialize();
    const first = pidOf(client);
    await client.initialize();

    expect(pidOf(client), "a live, initialized client must not respawn").toBe(first);
  }, 20_000);

  it("test_close_re_arms_initialize_so_a_disposed_session_can_start_over", async () => {
    const cfg = { type: "stdio" as const, command: "node", args: ["-e", ALIVE_SERVER] };
    const client = track(createMcpClient("srv", cfg));

    await client.initialize();
    const first = pidOf(client);
    await client.close();
    await client.initialize();

    expect(pidOf(client)).toBeTypeOf("number");
    expect(pidOf(client), "close released the child — initialize must spawn a new one").not.toBe(
      first,
    );
  }, 20_000);
});
