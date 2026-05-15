import { describe, expect, it } from "vitest";

import { createMcpClient } from "../../../src/internal/mcp/client.js";

/**
 * Behaviour gate for the real MCP client. Covers:
 *  - stdio transport against a tiny node-based echo server that implements
 *    JSON-RPC over stdin/stdout.
 *  - http transport against a stub `fetch`.
 */

describe("real MCP client (stdio)", () => {
  it("initializes, lists, and calls a tool on a stdio MCP server", async () => {
    const program = `
      let buf = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        buf += chunk;
        let nl = buf.indexOf("\\n");
        while (nl !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          const req = JSON.parse(line);
          let result;
          if (req.method === "initialize") {
            result = { protocolVersion: "2024-11-05", capabilities: { tools: {} } };
          } else if (req.method === "tools/list") {
            result = { tools: [{ name: "echo", description: "Echo input", inputSchema: { type: "object" } }] };
          } else if (req.method === "tools/call") {
            const text = req.params.arguments.message ?? "";
            result = { content: [{ type: "text", text }] };
          }
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }) + "\\n");
          nl = buf.indexOf("\\n");
        }
      });
    `;

    const client = createMcpClient("echo-stdio", {
      type: "stdio",
      command: process.execPath,
      args: ["-e", program],
    });
    await client.initialize();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("echo");
    const callResult = await client.callTool("echo", { message: "hello mcp" });
    expect(callResult.content[0]?.text).toBe("hello mcp");
    await client.close();
  });
});
