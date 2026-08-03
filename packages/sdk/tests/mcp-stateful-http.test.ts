import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createMcpClient } from "../src/internal/mcp/client.js";

/**
 * MCP Streamable HTTP — the STATEFUL half of the transport.
 *
 * ## What was measured, and why this file exists
 *
 * A server that follows the Streamable HTTP spec issues an `mcp-session-id` header on the
 * `initialize` response and REQUIRES it on every subsequent request. Measured against a real
 * server:
 *
 * ```
 * initialize            -> 200, mcp-session-id: <id>
 * tools/list  (no id)   -> 400          <- the client never sent it
 * tools/list  (with id) -> 200 + tools
 * ```
 *
 * `HttpMcpClient` held exactly one piece of per-instance state — `nextId` — and its comment
 * declared "the http transport is stateless". That is true of the *connection* and false of the
 * *session*: a stateful server never serves a single tool to this client.
 *
 * The `accept` header was a second, latent divergence found by reading rather than by failing: the
 * spec asks for both `application/json` and `text/event-stream`, and servers that enforce it reject
 * with 406 before the session issue is even reachable.
 */

const SESSION = "sess-abc-123";

interface Visto {
  method: string;
  sessionId: string | undefined;
  accept: string | undefined;
}

/** The body of one request, already read. */
function lerCorpo(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(c));
    req.on("end", () => {
      resolve(Buffer.concat(parts).toString("utf8"));
    });
  });
}

/** The RPC result for a method — tools for `tools/list`, the handshake otherwise. */
function resultadoDe(method: string | undefined): Record<string, unknown> {
  if (method === "tools/list") {
    return { tools: [{ name: "ping", description: "p", inputSchema: { type: "object" } }] };
  }
  return {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: { name: "stateful", version: "0" },
  };
}

/** True when the spec says this request must carry the session and it does not. */
function faltaSessao(
  opts: { emitSessionId: boolean },
  m: string | undefined,
  id: string | undefined,
): boolean {
  return opts.emitSessionId && m !== "initialize" && id !== SESSION;
}

/** A local server that speaks the stateful half of the MCP handshake. */
function statefulServer(opts: { emitSessionId: boolean }): Promise<{
  url: string;
  seen: Visto[];
  close: () => Promise<void>;
}> {
  const seen: Visto[] = [];
  const srv: Server = createServer((req, res) => {
    void lerCorpo(req).then((body) => {
      const parsed = JSON.parse(body) as { id?: unknown; method?: string };
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      seen.push({
        method: parsed.method ?? "?",
        sessionId,
        accept: req.headers.accept as string | undefined,
      });

      if (faltaSessao(opts, parsed.method, sessionId)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id ?? 1,
            error: { code: -32600, message: "missing session" },
          }),
        );
        return;
      }

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opts.emitSessionId && parsed.method === "initialize") {
        headers["mcp-session-id"] = SESSION;
      }
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({ jsonrpc: "2.0", id: parsed.id ?? 1, result: resultadoDe(parsed.method) }),
      );
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${String(port)}/mcp`,
        seen,
        close: () =>
          new Promise<void>((r) => {
            srv.close(() => {
              r();
            });
          }),
      });
    });
  });
}

describe("MCP Streamable HTTP — stateful session", () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  it("resends the mcp-session-id issued by initialize on every later request", async () => {
    const srv = await statefulServer({ emitSessionId: true });
    stop = srv.close;
    const client = createMcpClient("s", { type: "http", url: srv.url });

    await client.initialize();
    const tools = await client.listTools();

    expect(
      tools.map((t) => t.name),
      "the stateful server never served its tools",
    ).toEqual(["ping"]);
    const list = srv.seen.find((r) => r.method === "tools/list");
    expect(
      list?.sessionId,
      "tools/list went out without the mcp-session-id — the server answers 400 and the agent sees no tools",
    ).toBe("sess-abc-123");
  });

  it("sends no session header when the server issues none", async () => {
    // NEGATIVE — a stateless server must keep working exactly as before. Inventing a header here
    // would trade one broken transport for another.
    const srv = await statefulServer({ emitSessionId: false });
    stop = srv.close;
    const client = createMcpClient("s", { type: "http", url: srv.url });

    await client.initialize();
    await client.listTools();

    for (const r of srv.seen) {
      expect(r.sessionId, "a session header was invented for a stateless server").toBeUndefined();
    }
  });

  it("declares both media types in accept", async () => {
    const srv = await statefulServer({ emitSessionId: true });
    stop = srv.close;
    const client = createMcpClient("s", { type: "http", url: srv.url });

    await client.initialize();

    expect(
      srv.seen[0]?.accept,
      "accept omits text/event-stream — servers that enforce the spec reject with 406",
    ).toContain("text/event-stream");
    expect(srv.seen[0]?.accept, "accept dropped application/json").toContain("application/json");
  });

  it("still lets a user-supplied header win", async () => {
    // NEGATIVE, against regression: `.mcp.json` headers override the defaults, and that contract
    // predates this change. It is also the only escape a user has while a fix is in flight.
    const srv = await statefulServer({ emitSessionId: true });
    stop = srv.close;
    const client = createMcpClient("s", {
      type: "http",
      url: srv.url,
      headers: { accept: "application/json" },
    });

    await client.initialize();

    expect(srv.seen[0]?.accept, "the user-supplied accept stopped winning").toBe(
      "application/json",
    );
  });
});

/**
 * Um servidor que **honra o `Accept`**: responde `text/event-stream` quando o cliente o pede.
 *
 * Este e o fixture que faltava. O primeiro servidor deste arquivo devolve JSON qualquer que seja o
 * `Accept`, entao concordava com a producao ate a producao mudar: quando o cliente passou a pedir
 * SSE (a correcao da spec), um servidor real passou a responder SSE e `response.json()` quebrou com
 * `Unexpected token 'e', "event: mes"`. Medido em producao, nao imaginado.
 */
function sseServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const srv: Server = createServer((req, res) => {
    void lerCorpo(req).then((body) => {
      const parsed = JSON.parse(body) as { id?: unknown; method?: string };
      const aceita = String(req.headers.accept ?? "");
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id: parsed.id ?? 1,
        result: resultadoDe(parsed.method),
      });
      if (aceita.includes("text/event-stream")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`event: message\ndata: ${payload}\n\n`);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(payload);
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${String(port)}/mcp`,
        close: () =>
          new Promise<void>((r) => {
            srv.close(() => {
              r();
            });
          }),
      });
    });
  });
}

describe("MCP Streamable HTTP — resposta SSE", () => {
  it("parses a text/event-stream response instead of throwing on JSON.parse", async () => {
    // O cliente PEDE `text/event-stream`; um servidor que honra o pedido responde SSE. Antes desta
    // correcao, `response.json()` lancava e o servidor inteiro ficava sem tools — foi o que
    // aconteceu com um servidor real (`theo-skills`) apos a correcao do Accept.
    const srv = await sseServer();
    try {
      const client = createMcpClient("sse", { type: "http", url: srv.url });
      await client.initialize();
      const tools = await client.listTools();
      expect(
        tools.map((t) => t.name),
        "a resposta SSE nao foi parseada — o servidor serve zero tools",
      ).toEqual(["ping"]);
    } finally {
      await srv.close();
    }
  });
});
