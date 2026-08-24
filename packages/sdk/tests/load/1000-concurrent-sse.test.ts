/**
 * T0.3 — Load test: 1000 concurrent SSE clients against an in-process
 * fixture server. Validates that the SDK's SSE wire format (T3.1 hardening
 * lands later) sustains 1000 connections with p95 < 200ms.
 *
 * This iter ships a scaffold that EXERCISES the SSE driver harness with a
 * smaller smoke (100 connections) so CI runners without 4GB RAM still cover
 * the wire. T6.2 (load test 1000 conn p95 < 200ms) ratchets concurrency
 * to 1000 + asserts the perf budget.
 *
 * B-131 — the "zero CLOSE_WAIT leak" claim this file used to make is WITHDRAWN. Measured: deleting
 * the driver's own `client.socket.destroy()` entirely (`_harness/sse-driver.ts`) left CLOSE_WAIT at
 * 0 at both 100 and 1000 concurrency, on two separate runs (the original measurement and the re-run
 * below). Node's `net.Socket` defaults to `allowHalfOpen: false` (completes the FIN handshake on its
 * own) and the fixture server's `keepAliveTimeout` closes idle sockets — neither depends on any code
 * this repo owns, and this scenario has no `src/` production code in it at all (raw `node:http` /
 * `node:net`). The assertion had zero power to detect a leak in anything this repo ships.
 *
 * The real leak-detection duty now lives in `tests/subscription/theokit-subscribe-leak.test.ts`,
 * which drives `Theokit.subscribe`'s actual SSE/WS transports (the SDK path that genuinely owns
 * connection lifetime) with fetch/WebSocket injected — no network, no `ss`, no OS auto-close
 * semantics to hide behind — and is mutation-verified. See `tests/load/README.md`.
 *
 * The CLOSE_WAIT check below is kept as a harness smoke check ONLY: it still confirms the driver and
 * `socket-monitor.ts` cooperate without exploding, which is worth knowing, but it proves nothing
 * about SDK correctness and must not be read as a regression guard.
 */

import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertNoLingeringCloseWait, waitForCloseWaitBelow } from "./_harness/socket-monitor.js";
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

  it("harness smoke — driver + socket-monitor cooperate without exploding (NOT a leak detector, see B-131)", async (ctx) => {
    // B-131: this assertion is KNOWN to have zero power to detect a client-side socket leak — see
    // the file docblock. It is kept only as a smoke check that the driver and `socket-monitor.ts`
    // (whose own logic is unit-tested in `tests/socket-monitor.test.ts`) run together without
    // erroring. The real leak-detection duty is `tests/subscription/theokit-subscribe-leak.test.ts`.
    //
    // B-022: polls the real count instead of sleeping a fixed 500ms — the OS decides teardown
    // timing, not the test process.
    //
    // B-099: an unmeasurable environment now reports SKIPPED with its reason. It used to return a
    // silent pass, so a machine without `ss` was indistinguishable from one where the assertion held.
    //
    // Threshold dropped 25 -> 5, the value socket-monitor.ts's own docblock documents; the 25 at this
    // call site never matched it and never explained itself. Measured locally at 100 and 1000
    // concurrency: CLOSE_WAIT drains to 0 within the same tick the driver finishes, so 5 is not
    // tight. If CI hardware makes 5 flake where 25 did not, that is new evidence the loose budget was
    // hiding — raise it with a recorded reason, never silently.
    const result = await waitForCloseWaitBelow(5, { deadlineMs: 3_000 });
    if (!result.available) {
      ctx.skip(result.reason);
      return;
    }
    assertNoLingeringCloseWait(result, /* threshold */ 5);
  });

  it.todo(
    "the SDK SSE wire sustains 1000 connections at p95 < 200ms — owner B-037, sunset 2026-11-19 (T6.2)",
  );
});
