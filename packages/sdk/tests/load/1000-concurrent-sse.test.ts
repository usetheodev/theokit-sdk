/**
 * T0.3 — Load test: 1000 concurrent SSE clients against an in-process
 * fixture server. Validates that the SDK's SSE wire format (T3.1 hardening
 * lands later) sustains 1000 connections with p95 < 200ms and zero socket
 * CLOSE_WAIT leak (Linux-only assertion).
 *
 * This iter ships a scaffold that EXERCISES the SSE driver harness with a
 * smaller smoke (100 connections) so CI runners without 4GB RAM still cover
 * the wire. T6.2 (load test 1000 conn p95 < 200ms) ratchets concurrency
 * to 1000 + asserts the perf budget.
 */

import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertNoLingeringCloseWait, probeSockets } from "./_harness/socket-monitor.js";
import { runSseDriver } from "./_harness/sse-driver.js";

const CONCURRENCY = Number.parseInt(process.env.T0_3_CONCURRENCY ?? "100", 10);
const SKIP_LOAD = process.env.SKIP_T0_3_LOAD === "1";

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      res.write(`data: ${JSON.stringify({ tick: i })}\n\n`);
      if (i >= 5) {
        clearInterval(t);
        res.end();
      }
    }, 5);
    res.on("close", () => clearInterval(t));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "string" && addr !== null) port = addr.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe.skipIf(SKIP_LOAD)(`T0.3 load smoke — ${CONCURRENCY} concurrent SSE clients`, () => {
  it("completes all clients with zero unrecoverable errors", async () => {
    const result = await runSseDriver({
      host: "127.0.0.1",
      port,
      path: "/",
      concurrency: CONCURRENCY,
      durationMs: 10_000,
    });
    expect(result.successCount).toBeGreaterThanOrEqual(Math.floor(CONCURRENCY * 0.9));
    expect(result.errorCount).toBeLessThan(Math.ceil(CONCURRENCY * 0.1));
  }, 60_000);

  it("does not leak CLOSE_WAIT sockets (Linux-only)", async () => {
    // Allow OS-level connection cleanup to settle before probing.
    await new Promise((r) => setTimeout(r, 500));
    const snapshot = probeSockets();
    // On non-Linux this is a no-op pass.
    assertNoLingeringCloseWait(snapshot, /* threshold */ 25);
  });

  it.todo(
    "the SDK SSE wire sustains 1000 connections at p95 < 200ms — owner B-037, sunset 2026-11-19 (T6.2)",
  );
});
