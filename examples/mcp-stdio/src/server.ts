/**
 * Tiny MCP stdio server. Implements the minimum the SDK needs:
 *   - `initialize`
 *   - `tools/list`
 *   - `tools/call`
 *
 * The single tool, `time.now`, returns the current ISO timestamp plus a
 * configurable timezone offset. Used by the mcp-stdio example to prove
 * that the agent can discover and invoke MCP-provided tools.
 */

interface JsonRpc {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);
    if (line.trim().length > 0) handleLine(line);
    newlineIndex = buffer.indexOf("\n");
  }
});

function handleLine(line: string): void {
  let request: JsonRpc;
  try {
    request = JSON.parse(line) as JsonRpc;
  } catch {
    return;
  }
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } },
    });
    return;
  }
  if (request.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [
          {
            name: "time.now",
            description: "Return the current ISO timestamp, optionally shifted by N hours.",
            inputSchema: {
              type: "object",
              properties: {
                offsetHours: {
                  type: "number",
                  description: "Number of hours to add (can be negative).",
                },
              },
            },
          },
        ],
      },
    });
    return;
  }
  if (request.method === "tools/call" && request.params?.name === "time.now") {
    const offsetHoursRaw = request.params.arguments?.offsetHours;
    const offsetHours = typeof offsetHoursRaw === "number" ? offsetHoursRaw : 0;
    const now = new Date(Date.now() + offsetHours * 60 * 60 * 1000);
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [{ type: "text", text: now.toISOString() }],
      },
    });
    return;
  }
  send({
    jsonrpc: "2.0",
    id: request.id,
    error: { code: -32601, message: `Method not found: ${request.method}` },
  });
}
