/**
 * In-process SSE driver for T0.3 load tests.
 *
 * The standard load harnesses (autocannon, wrk) treat SSE as HTTP/1.1 and
 * mismeasure throughput because they close the connection on the first
 * response body bytes. Our SDK streams via `EventSource`-style SSE, so we
 * need a harness that:
 *
 *   1. Opens N concurrent HTTP connections to an in-process server.
 *   2. Reads each one as an SSE event stream (`data:` lines + `\n\n`
 *      terminators per HTML Living Standard § 9.2.6 — T3.1 will harden
 *      the parser; this driver uses the SDK's `parseSseW3C` indirectly).
 *   3. Tracks per-connection latency p50 / p95 / p99.
 *   4. Detects socket leak on cleanup (caller asserts via `socket-monitor`).
 *
 * The driver is process-local so the load test owns BOTH endpoints; CI runs
 * it as a smoke (1000 connections) against a fixture SSE server.
 *
 * @internal
 */

import { connect, type Socket } from "node:net";

interface SseClient {
  connectionId: number;
  eventsReceived: number;
  bytesReceived: number;
  closedNormally: boolean;
  firstByteMs?: number;
  endMs?: number;
  startMs: number;
  socket: Socket;
}

interface DriverResult {
  clients: ReadonlyArray<SseClient>;
  durationMs: number;
  successCount: number;
  errorCount: number;
  latencies: {
    firstByteMs: { p50: number; p95: number; p99: number };
    totalMs: { p50: number; p95: number; p99: number };
  };
}

interface DriverOptions {
  host: string;
  port: number;
  path?: string;
  concurrency: number;
  /** Bytes-received threshold beyond which the driver early-closes a client. */
  maxBytesPerClient?: number;
  /** Total run time before the driver tears everyone down (ms). */
  durationMs?: number;
}

/**
 * Run N parallel SSE clients against the configured server until either
 * every client receives at least one event AND closes naturally OR the
 * `durationMs` window elapses.
 */
export async function runSseDriver(opts: DriverOptions): Promise<DriverResult> {
  const concurrency = opts.concurrency;
  const path = opts.path ?? "/stream";
  const maxBytes = opts.maxBytesPerClient ?? 64 * 1024;
  const duration = opts.durationMs ?? 30_000;
  const startedAt = Date.now();
  const clients: SseClient[] = [];
  const all: Promise<void>[] = [];

  for (let i = 0; i < concurrency; i += 1) {
    all.push(runOneClient(i, opts.host, opts.port, path, maxBytes, duration, clients));
  }

  await Promise.allSettled(all);

  const durationMs = Date.now() - startedAt;
  const firstByteLatencies = clients
    .map((c) =>
      c.firstByteMs !== undefined ? c.firstByteMs - c.startMs : Number.POSITIVE_INFINITY,
    )
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const totalLatencies = clients
    .map((c) => (c.endMs !== undefined ? c.endMs - c.startMs : Number.POSITIVE_INFINITY))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  return {
    clients,
    durationMs,
    successCount: clients.filter((c) => c.closedNormally).length,
    errorCount: clients.filter((c) => !c.closedNormally).length,
    latencies: {
      firstByteMs: percentiles(firstByteLatencies),
      totalMs: percentiles(totalLatencies),
    },
  };
}

async function runOneClient(
  id: number,
  host: string,
  port: number,
  path: string,
  maxBytes: number,
  durationMs: number,
  clients: SseClient[],
): Promise<void> {
  const client: SseClient = {
    connectionId: id,
    eventsReceived: 0,
    bytesReceived: 0,
    closedNormally: false,
    startMs: Date.now(),
    socket: connect({ host, port }),
  };
  clients.push(client);
  return new Promise<void>((resolve) => {
    let buffer = Buffer.alloc(0);
    let timer: NodeJS.Timeout | undefined;
    const cleanup = (closedOk: boolean): void => {
      client.endMs = Date.now();
      client.closedNormally = closedOk;
      if (timer !== undefined) clearTimeout(timer);
      client.socket.destroy();
      resolve();
    };
    client.socket.on("connect", () => {
      const req =
        `GET ${path} HTTP/1.1\r\n` +
        `Host: ${host}:${port}\r\n` +
        "Accept: text/event-stream\r\n" +
        "Connection: keep-alive\r\n\r\n";
      client.socket.write(req);
      timer = setTimeout(() => cleanup(false), durationMs);
    });
    client.socket.on("data", (chunk: Buffer) => {
      if (client.firstByteMs === undefined) client.firstByteMs = Date.now();
      client.bytesReceived += chunk.byteLength;
      buffer = Buffer.concat([buffer, chunk]);
      // Count complete SSE events ("\n\n" terminators per HTML LS § 9.2.6).
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        client.eventsReceived += 1;
        buffer = buffer.subarray(idx + 2);
        idx = buffer.indexOf("\n\n");
      }
      if (client.bytesReceived >= maxBytes) cleanup(true);
    });
    client.socket.on("error", () => cleanup(false));
    client.socket.on("close", () => {
      if (client.endMs === undefined) cleanup(client.eventsReceived > 0);
    });
  });
}

function percentiles(sorted: number[]): { p50: number; p95: number; p99: number } {
  if (sorted.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const pick = (q: number): number => {
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
    return sorted[idx] ?? 0;
  };
  return { p50: pick(0.5), p95: pick(0.95), p99: pick(0.99) };
}
