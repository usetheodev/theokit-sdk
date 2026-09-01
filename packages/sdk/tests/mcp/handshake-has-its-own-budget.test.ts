/**
 * The connect handshake is not bounded by the per-request timeout.
 *
 * `requestTimeoutMs` sizes a steady-state RPC. The handshake is not one: it pays for a process spawn
 * plus the server's own startup before it can answer. Binding both to the same number means a caller
 * who sets a tight request budget — an ordinary thing to do for a latency SLO — silently makes their
 * client unable to CONNECT, and unable to RECONNECT after a drop: `reconnect()` burns all its
 * attempts, each spawning a child that cannot finish in time, and surfaces `mcp_disconnected`. That
 * is exactly the wedge the bounded-retry loop exists to prevent.
 *
 * It was found as a flaky test rather than as a bug report. `client-reconnect.test.ts`'s "a timed-out
 * server is reconnectable on the next request" failed under full-suite load and passed in isolation;
 * its 300ms is deliberate fault injection, and the RECOVERY path was bounded by that same 300ms, so
 * on a loaded host recovery could not fit. Raising the 300ms would have made the suite green while
 * hiding the defect — the one move that must not be made here.
 *
 * These cases are deterministic: the mock sleeps a fixed time before answering `initialize`, which is
 * longer than the request budget and shorter than the handshake floor.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { createMcpClient } from "../../src/internal/mcp/client.js";
import { removeTempDirRobustSync } from "../helpers/temp-workspace.js";

/**
 * A server whose FIRST spawn answers everything promptly and then exits on `tools/list`, and whose
 * LATER spawns take `delayMs` to answer `initialize`.
 *
 * That shape reproduces the real sequence: connect cleanly, get dropped mid-request, then have the
 * RECONNECT handshake outlast the caller's request budget. A per-process counter file makes the
 * spawns distinguishable.
 */
function dropThenSlowHandshakeScript(counterFile: string, delayMs: number): string {
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
        if (msg.method === "tools/list" && n === 0) { process.exit(0); }
        const reply = () => process.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } }) + "\\n");
        if (msg.method === "initialize" && n > 0) setTimeout(reply, ${String(delayMs)});
        else reply();
      }
    });
  `;
}

function scriptFile(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "theokit-mcp-handshake-"));
  onTestFinished(() => {
    removeTempDirRobustSync(dir);
  });
  const file = join(dir, "server.cjs");
  writeFileSync(file, source);
  return file;
}

describe("MCP handshake budget", () => {
  it("RECONNECTS when the recovery handshake outlasts a tight requestTimeoutMs", async () => {
    // 120ms request budget; the reconnect handshake takes 400ms. Bound to the request budget, every
    // one of MAX_RECONNECT_ATTEMPTS spawns a child that cannot answer in time, the loop exhausts and
    // the client surfaces mcp_disconnected — wedged, which is what the bounded loop exists to
    // prevent.
    const dir = mkdtempSync(join(tmpdir(), "theokit-mcp-handshake-"));
    onTestFinished(() => {
      removeTempDirRobustSync(dir);
    });
    const counter = join(dir, "spawns.txt");
    const client = createMcpClient("reconnecting", {
      type: "stdio",
      command: process.execPath,
      args: [scriptFile(dropThenSlowHandshakeScript(counter, 400))],
      requestTimeoutMs: 120,
    });
    onTestFinished(async () => {
      await client.close();
    });

    await client.initialize();
    // The first spawn exits on tools/list without replying — a real mid-request drop.
    await expect(client.listTools()).rejects.toMatchObject({ code: "mcp_disconnected" });

    // The next request must recover. This is the assertion the floor exists for.
    await expect(client.listTools()).resolves.toEqual([]);
  }, 30_000);

  it("the FIRST connect keeps the caller's budget — the floor is not a global raise", async () => {
    // Deliberately unchanged, and the reason is which failure is visible. A requestTimeoutMs too
    // small to connect at all fails at the call the caller made, immediately, and is theirs to
    // correct. `client-timeout.test.ts` pins it: a silent server rejects within 2s at 150ms. A floor
    // on first connect would make that wait the floor instead.
    const client = createMcpClient("slow-first-connect", {
      type: "stdio",
      command: "sh",
      args: ["-c", "cat >/dev/null"],
      requestTimeoutMs: 100,
    });
    onTestFinished(async () => {
      await client.close();
    });

    const started = Date.now();
    await expect(client.initialize()).rejects.toMatchObject({ code: "mcp_timeout" });
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 30_000);

  it("still bounds an ORDINARY request by requestTimeoutMs — the floor is not a global raise", async () => {
    // The counter-proof. A floor that applied to every method would make `requestTimeoutMs` a
    // suggestion, which is a worse defect than the one being fixed.
    //
    // The oracle is the ERROR, not the clock. A first version asserted elapsed wall time and failed
    // under full-suite load for a reason that had nothing to do with the claim — the connect itself
    // could not fit its own budget on a loaded host. An assertion about "was fast" is the fragile
    // shape; "was cut at the budget it names" is the durable one, and it is also the actual claim.
    const neverAnswersToolsList = `
      let buf = "";
      process.stdin.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.method === "tools/list") continue;
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    // Generous enough that a loaded host still connects; far below the 10s handshake floor, so a
    // floor leaking onto ordinary methods would be visible in the message below.
    const client = createMcpClient("slow-request", {
      type: "stdio",
      command: process.execPath,
      args: [scriptFile(neverAnswersToolsList)],
      requestTimeoutMs: 2_000,
    });
    onTestFinished(async () => {
      await client.close();
    });

    await client.initialize();
    await expect(client.listTools()).rejects.toMatchObject({
      code: "mcp_timeout",
      // Names 2000, not 10000: the ordinary request was cut at ITS budget.
      message: expect.stringContaining("2000ms"),
    });
  }, 30_000);
});
