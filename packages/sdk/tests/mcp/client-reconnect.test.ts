/**
 * M2 #59 (T3.1) — RED-first: a stdio MCP child that exits mid-session must
 * reject pending requests with a typed `mcp_disconnected` (not hang), and the
 * next request must reconnect (re-spawn + re-initialize) with backoff.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMcpClient } from "../../src/internal/mcp/client.js";

// A node MCP mock that replies {tools:[]} to every JSON-RPC request. A per-process
// counter file makes the FIRST spawn (n=0) exit WITHOUT replying the moment it sees a
// tools/list — a deterministic mid-request drop (no stdout-flush race). It still
// answers the initial `initialize`, so the client is fully connected before the drop.
// Later spawns (n>=1) answer everything and stay alive, so the reconnect can succeed.
function mockServerScript(counterFile: string): string {
  return `
    const fs = require("node:fs");
    let n = 0;
    try { n = parseInt(fs.readFileSync(${JSON.stringify(counterFile)}, "utf8"), 10) || 0; } catch {}
    fs.writeFileSync(${JSON.stringify(counterFile)}, String(n + 1));
    let buf = "";
    process.stdin.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.method === "tools/list" && n === 0) { process.exit(0); } // drop before replying
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } }) + "\\n");
      }
    });
  `;
}

describe("MCP stdio reconnect-after-drop (#59)", () => {
  it("child exit mid-request rejects pending with a typed mcp_disconnected (no hang)", async () => {
    // A server that reads our request but exits ~150ms later without replying.
    const client = createMcpClient("dropper", {
      type: "stdio",
      command: "sh",
      args: ["-c", "cat >/dev/null & sleep 0.15"],
      requestTimeoutMs: 30_000, // long — so the rejection is the drop, not the timeout
    });
    await expect(client.initialize()).rejects.toMatchObject({ code: "mcp_disconnected" });
    await client.close();
  });

  it("reconnects on the next request after a drop (re-spawn + re-initialize)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-reconnect-"));
    const counterFile = join(dir, "count");
    writeFileSync(counterFile, "0");
    const client = createMcpClient("reconnecter", {
      type: "stdio",
      command: "node",
      args: ["-e", mockServerScript(counterFile)],
      requestTimeoutMs: 30_000,
    });
    // First spawn (n=0) answers initialize → client fully connected.
    await client.initialize();
    // The first listTools() hits the mid-request drop (process 0 exits before
    // replying) → rejects the in-flight request with a typed mcp_disconnected.
    await expect(client.listTools()).rejects.toMatchObject({ code: "mcp_disconnected" });
    // The NEXT request reconnects to a fresh spawn (n=1, stays alive) →
    // re-initialize → tools/list succeeds. Without reconnect this would hang / mcp_not_init.
    const tools = await client.listTools();
    expect(tools).toEqual([]);
    await client.close();
  });

  it("a request before initialize fails fast with mcp_not_init (never-initialized ≠ dropped)", async () => {
    const client = createMcpClient("uninit", {
      type: "stdio",
      command: "sh",
      args: ["-c", "cat >/dev/null"],
      requestTimeoutMs: 1_000,
    });
    await expect(client.listTools()).rejects.toMatchObject({ code: "mcp_not_init" });
    await client.close();
  });
});
