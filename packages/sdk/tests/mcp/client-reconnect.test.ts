/**
 * M2 #59 (T3.1) — RED-first: a stdio MCP child that exits mid-session must
 * reject pending requests with a typed `mcp_disconnected` (not hang), and the
 * next request must reconnect (re-spawn + re-initialize) with backoff.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createMcpClient } from "../../src/internal/mcp/client.js";
import { removeTempDirRobustSync } from "../helpers/temp-workspace.js";

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
    const __dirCleanup1 = dir;
    onTestFinished(() => {
      removeTempDirRobustSync(__dirCleanup1);
    });
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

  it("a timed-out server is reconnectable on the next request (not permanently wedged)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-timeout-reconnect-"));
    const __dirCleanup2 = dir;
    onTestFinished(() => {
      removeTempDirRobustSync(__dirCleanup2);
    });
    const counterFile = join(dir, "count");
    writeFileSync(counterFile, "0");
    // Mock: first spawn (n=0) reads but NEVER replies (forces a request timeout);
    // later spawns reply normally so the reconnect can succeed.
    const script = `
      const fs = require("node:fs");
      let n = 0;
      try { n = parseInt(fs.readFileSync(${JSON.stringify(counterFile)}, "utf8"), 10) || 0; } catch {}
      fs.writeFileSync(${JSON.stringify(counterFile)}, String(n + 1));
      let buf = "";
      process.stdin.on("data", (d) => {
        buf += d; let i;
        while ((i = buf.indexOf("\\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          if (n === 0) continue; // first spawn: swallow, never reply → timeout
          const msg = JSON.parse(line);
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } }) + "\\n");
        }
      });
    `;
    const client = createMcpClient("timeout-reconnect", {
      type: "stdio",
      command: "node",
      args: ["-e", script],
      requestTimeoutMs: 300, // short — the first initialize times out
    });
    // First spawn never replies → initialize times out (typed) + marks the client dropped.
    await expect(client.initialize()).rejects.toMatchObject({ code: "mcp_timeout" });
    // The next request reconnects to a fresh (replying) spawn — no permanent wedge.
    expect(await client.listTools()).toEqual([]);
    await client.close();
  });

  it("reconnect is bounded — repeated drops surface a typed 'reconnect exhausted' (H3)", async () => {
    // A server that spawns then exits immediately: every reconnect handshake drops,
    // so the bounded loop must eventually surface mcp_disconnected instead of looping forever.
    const client = createMcpClient("exhaust", {
      type: "stdio",
      command: "sh",
      args: ["-c", "exit 0"],
      requestTimeoutMs: 5_000,
    });
    await expect(client.initialize()).rejects.toBeDefined(); // spawn exits → drop
    let last: unknown;
    for (let i = 0; i < 6; i++) {
      try {
        await client.listTools();
      } catch (err) {
        last = err;
      }
    }
    expect(last).toMatchObject({ code: "mcp_disconnected" });
    expect(String((last as Error).message)).toMatch(/exhausted/i);
    await client.close();
  });

  it("recovers after a transient outage exceeds the per-cycle attempt bound (no permanent wedge, #59)", async () => {
    // Server exits for the first 3 spawns (n<3), then stays alive + replies.
    // A transient outage longer than the per-cycle bound must NOT permanently
    // wedge the client — a later request must re-arm and reconnect.
    const dir = mkdtempSync(join(tmpdir(), "mcp-rearm-"));
    const __dirCleanup3 = dir;
    onTestFinished(() => {
      removeTempDirRobustSync(__dirCleanup3);
    });
    const counterFile = join(dir, "count");
    writeFileSync(counterFile, "0");
    const script = `
      const fs = require("node:fs");
      let n = 0;
      try { n = parseInt(fs.readFileSync(${JSON.stringify(counterFile)}, "utf8"), 10) || 0; } catch {}
      fs.writeFileSync(${JSON.stringify(counterFile)}, String(n + 1));
      if (n < 3) { process.exit(0); } // transient outage: first 3 spawns drop
      let buf = "";
      process.stdin.on("data", (d) => {
        buf += d; let i;
        while ((i = buf.indexOf("\\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } }) + "\\n");
        }
      });
    `;
    const client = createMcpClient("rearm", {
      type: "stdio",
      command: "node",
      args: ["-e", script],
      requestTimeoutMs: 30_000,
    });
    await expect(client.initialize()).rejects.toBeDefined(); // spawn 0 exits → drop

    // Old code wedges permanently after the lifetime attempt cap; the fix re-arms
    // per request so the healthy spawn (n>=3) is eventually reached.
    let recovered = false;
    for (let i = 0; i < 6; i++) {
      try {
        const tools = await client.listTools();
        expect(tools).toEqual([]);
        recovered = true;
        break;
      } catch {
        // still in the outage window — try again
      }
    }
    expect(recovered).toBe(true);
    await client.close();
  });

  it("http client recovers on the next request after a transport failure (#59, stateless)", async () => {
    // The HTTP transport is stateless — each POST opens a fresh connection — so a
    // transport failure on one request must NOT wedge the client; the next request
    // reconnects inherently. (Plan D3 promised this test; it was missing.)
    let calls = 0;
    const okResponse = (result: unknown): Response =>
      ({
        ok: true,
        status: 200,
        // `headers` is not decoration: `readBody` reads `content-type` to tell JSON from SSE, and
        // `captureSession` reads `mcp-session-id`. A fake without it throws a TypeError BEFORE the
        // behaviour under test runs — which is how this test started measuring nothing.
        headers: new Headers(),
        json: () => Promise.resolve({ jsonrpc: "2.0", id: calls, result }),
      }) as unknown as Response;
    const flaky: typeof fetch = () => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error("ECONNRESET")); // 1st listTools drops
      return Promise.resolve(okResponse({ tools: [] }));
    };
    const client = createMcpClient(
      "http-recover",
      { type: "http", url: "https://mcp.example.test", requestTimeoutMs: 5_000 },
      flaky,
    );
    await client.initialize(); // call 1 — ok
    await expect(client.listTools()).rejects.toThrow(/ECONNRESET/); // call 2 — transport drop
    expect(await client.listTools()).toEqual([]); // call 3 — recovered (fresh POST)
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
