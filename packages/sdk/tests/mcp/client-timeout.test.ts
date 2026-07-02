import { describe, expect, it } from "vitest";
import { createMcpClient } from "../../src/internal/mcp/client.js";

/**
 * #59 — an MCP request that never gets a reply must not hang the agent loop.
 *
 * RED (pre-fix): `StdioMcpClient.request` returns a Promise that never resolves
 * when the server is silent, and `HttpMcpClient.request` passes no timeout to
 * `fetch`. Both hang until the test runner's timeout kills them.
 */
describe("MCP request timeout (#59)", () => {
  it("stdio request rejects a typed timeout when the server is silent", async () => {
    // `cat` reads stdin (our request) but never writes a reply → hangs today.
    const client = createMcpClient("silent-stdio", {
      type: "stdio",
      command: "sh",
      args: ["-c", "cat >/dev/null"],
      requestTimeoutMs: 150,
    });
    const start = Date.now();
    await expect(client.initialize()).rejects.toMatchObject({ code: "mcp_timeout" });
    expect(Date.now() - start).toBeLessThan(2000);
    await client.close();
  });

  it("http request maps an aborted fetch to a typed timeout", async () => {
    // Simulates a real fetch under AbortSignal.timeout: rejects when aborted.
    const honorsAbort: typeof fetch = (_url, opts) =>
      new Promise((_resolve, reject) => {
        const signal = (opts as RequestInit | undefined)?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")));
      });
    const client = createMcpClient(
      "silent-http",
      { type: "http", url: "https://mcp.example.test", requestTimeoutMs: 100 },
      honorsAbort,
    );
    await expect(client.initialize()).rejects.toMatchObject({ code: "mcp_timeout" });
  });

  it("EC-5: close() during a pending stdio request rejects it (no hang, no leak)", async () => {
    const client = createMcpClient("closeable", {
      type: "stdio",
      command: "sh",
      args: ["-c", "cat >/dev/null"],
      requestTimeoutMs: 60_000, // long — so the rejection is close(), not the timeout
    });
    const pending = client.initialize(); // never gets a reply
    await client.close(); // settles the in-flight request
    await expect(pending).rejects.toMatchObject({ code: "mcp_closed" });
  });

  it("EC-6: a non-abort fetch error is surfaced unchanged (not mislabeled a timeout)", async () => {
    const boom: typeof fetch = () => Promise.reject(new Error("ECONNREFUSED"));
    const client = createMcpClient(
      "boom-http",
      { type: "http", url: "https://mcp.example.test", requestTimeoutMs: 5000 },
      boom,
    );
    await expect(client.initialize()).rejects.toThrow(/ECONNREFUSED/);
  });
});
