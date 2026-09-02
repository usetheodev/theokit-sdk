/**
 * Linux-only socket monitor for T0.3 load tests.
 *
 * Shells `ss -tnp` (TCP, no DNS, with PID) to count CLOSE_WAIT and
 * TIME_WAIT sockets bound to the current Node PID. Used post-test to
 * detect connection leaks that vitest's pool isolation otherwise hides.
 *
 * On non-Linux platforms (Mac/Win/CI w/o `ss`), or when `ss` itself fails,
 * `probeSocketsResult` returns `{ available: false, reason }` instead of a
 * bare `null` — B-099: a caller that discards the distinction between
 * "measured zero" and "could not measure" reports a pass for a leak nobody
 * looked for, on every machine without `ss`. Callers MUST branch on
 * `available` and report the test outcome as skipped (naming `reason`),
 * never as passed, when it is `false`.
 *
 * @internal
 */

import { execFileSync } from "node:child_process";
import { platform } from "node:os";

interface SocketSnapshot {
  pid: number;
  closeWaitCount: number;
  timeWaitCount: number;
  establishedCount: number;
}

/** A real measurement, or a stated reason none could be taken. Never both, never neither. */
type ProbeResult =
  | { readonly available: true; readonly snapshot: SocketSnapshot }
  | { readonly available: false; readonly reason: string };

/**
 * Probe CLOSE_WAIT/TIME_WAIT/ESTABLISHED socket counts for `pid` via `ss -tnp`.
 * Returns `{ available: false, reason }` whenever nothing was measured:
 * non-Linux platform, `ss` missing, `ss` erroring, or the 2s exec timeout
 * firing. This is the B-099 fix — the reason is always present so a caller
 * cannot accidentally treat absence-of-measurement as absence-of-leak.
 */
export function probeSocketsResult(pid: number = process.pid): ProbeResult {
  const os = platform();
  if (os !== "linux") {
    return {
      available: false,
      reason: `socket-monitor: platform "${os}" has no \`ss\`-based CLOSE_WAIT probe (Linux-only)`,
    };
  }
  try {
    const out = execFileSync("ss", ["-tnp"], { encoding: "utf8", timeout: 2_000 });
    return { available: true, snapshot: parseSsOutput(out, pid) };
  } catch (err) {
    return {
      available: false,
      reason: `socket-monitor: \`ss -tnp\` probe failed (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

/**
 * @deprecated Use {@link probeSocketsResult} — this collapses "could not
 * measure" into the same `null` shape a caller might mistake for "measured
 * zero". Kept only so any caller not yet migrated keeps compiling; do not
 * add new call sites.
 */
export function probeSockets(pid: number = process.pid): SocketSnapshot | null {
  const result = probeSocketsResult(pid);
  return result.available ? result.snapshot : null;
}

function parseSsOutput(output: string, pid: number): SocketSnapshot {
  const lines = output.split("\n");
  let close = 0;
  let timeWait = 0;
  let established = 0;
  for (const line of lines) {
    if (!line.includes(`pid=${pid}`)) continue;
    if (line.startsWith("CLOSE-WAIT")) close += 1;
    else if (line.startsWith("TIME-WAIT")) timeWait += 1;
    else if (line.startsWith("ESTAB")) established += 1;
  }
  return { pid, closeWaitCount: close, timeWaitCount: timeWait, establishedCount: established };
}

/**
 * Poll {@link probeSocketsResult} until `closeWaitCount` drops to `threshold`
 * or `deadlineMs` elapses — the B-022 fix for the fixed 500ms sleep. TCP
 * teardown timing is decided by the OS, not by the process, so the only
 * correct synchronisation primitive is "keep checking the actual count",
 * not "wait a duration that happened to be enough once".
 *
 * Returns the LAST result observed. When unavailable, returns immediately
 * (there is nothing to poll for). When available but still over threshold
 * at the deadline, returns that final snapshot so the caller's failure
 * message reports the real count instead of a guess.
 */
export async function waitForCloseWaitBelow(
  threshold: number,
  opts: { pid?: number; deadlineMs?: number; pollIntervalMs?: number } = {},
): Promise<ProbeResult> {
  const pid = opts.pid ?? process.pid;
  const deadlineMs = opts.deadlineMs ?? 5_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 25;
  const start = Date.now();
  let result = probeSocketsResult(pid);
  while (
    result.available &&
    result.snapshot.closeWaitCount > threshold &&
    Date.now() - start < deadlineMs
  ) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    result = probeSocketsResult(pid);
  }
  return result;
}

/**
 * Assert that a {@link ProbeResult} shows no lingering CLOSE_WAIT sockets
 * above `threshold` (DoD: ≤ 5 for a 1000-concurrent-SSE run measured at full
 * concurrency — see the call-site note in `concurrent-sse-1000.test.ts` for
 * why the default smoke run may use a different, explicitly-reasoned budget).
 *
 * Unlike the pre-B-099 version, this THROWS on `available: false` instead of
 * silently returning. It is deliberately not the caller's silent fallback:
 * a caller that wants "skip, don't fail, when unmeasurable" must check
 * `result.available` itself and skip the test BEFORE calling this — see the
 * usage note below. That makes "test passed" and "nothing was measured"
 * impossible to conflate by omission.
 */
export function assertNoLingeringCloseWait(result: ProbeResult, threshold: number = 5): void {
  if (!result.available) {
    throw new Error(
      `socket-monitor: cannot assert — ${result.reason}. Callers must check ` +
        `result.available and skip (naming the reason) rather than calling ` +
        `assertNoLingeringCloseWait when unavailable.`,
    );
  }
  if (result.snapshot.closeWaitCount > threshold) {
    throw new Error(
      `socket-monitor: ${result.snapshot.closeWaitCount} CLOSE_WAIT sockets remain for pid ${result.snapshot.pid} (threshold ${threshold}). Leak suspected.`,
    );
  }
}
