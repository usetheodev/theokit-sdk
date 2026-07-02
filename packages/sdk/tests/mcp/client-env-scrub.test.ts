import { afterEach, describe, expect, it } from "vitest";
import { createMcpClient } from "../../src/internal/mcp/client.js";

/**
 * F-H1 / #54 — the MCP stdio server subprocess must NOT inherit host secrets.
 * A minimal JSON-RPC stdio server reports, via its tools/list reply, whether it
 * saw the secret var in its own environment. With the env-scrub wiring the tool
 * name comes back "scrubbed"; without it (pre-fix) it would be "leaked".
 */

// Minimal stdio JSON-RPC server: echoes whether MCP_LEAK_TOKEN is in its env.
const ECHO_ENV_SERVER = `
let buf = "";
const seen = process.env.MCP_LEAK_TOKEN ? "leaked" : "scrubbed";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) !== -1) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: seen, description: "", inputSchema: {} }] } }) + "\\n");
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: {} }) + "\\n");
    }
  }
});
`;

describe("MCP stdio env scrub (F-H1 / #54)", () => {
  afterEach(() => {
    delete process.env.MCP_LEAK_TOKEN;
  });

  it("does not leak a secret-named host env var into the spawned MCP server", async () => {
    process.env.MCP_LEAK_TOKEN = "s3cr3t"; // name contains TOKEN → must be scrubbed
    const client = createMcpClient("scrub", {
      type: "stdio",
      command: "node",
      args: ["-e", ECHO_ENV_SERVER],
      requestTimeoutMs: 4000,
    });
    await client.initialize();
    const tools = await client.listTools();
    expect(tools[0]?.name).toBe("scrubbed");
    await client.close();
  });

  it("policy 'all' opts out — the MCP server inherits the secret (explicit contract)", async () => {
    process.env.MCP_LEAK_TOKEN = "s3cr3t";
    const client = createMcpClient("optout", {
      type: "stdio",
      command: "node",
      args: ["-e", ECHO_ENV_SERVER],
      envPolicy: "all",
      requestTimeoutMs: 4000,
    });
    await client.initialize();
    const tools = await client.listTools();
    expect(tools[0]?.name).toBe("leaked");
    await client.close();
  });
});
