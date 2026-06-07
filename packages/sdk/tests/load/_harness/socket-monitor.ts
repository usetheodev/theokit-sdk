/**
 * Linux-only socket monitor for T0.3 load tests.
 *
 * Shells `ss -tnp` (TCP, no DNS, with PID) to count CLOSE_WAIT and
 * TIME_WAIT sockets bound to the current Node PID. Used post-test to
 * detect connection leaks that vitest's pool isolation otherwise hides.
 *
 * On non-Linux platforms (Mac/Win/CI w/o `ss`), `probeSockets` returns
 * `null` and callers `it.skipIf(monitor === null)` the leak assertion.
 *
 * @internal
 */

import { execFileSync } from "node:child_process";
import { platform } from "node:os";

export interface SocketSnapshot {
  pid: number;
  closeWaitCount: number;
  timeWaitCount: number;
  establishedCount: number;
}

/** Return null when `ss` is not available (Mac, Windows, restricted CI). */
export function probeSockets(pid: number = process.pid): SocketSnapshot | null {
  if (platform() !== "linux") return null;
  try {
    const out = execFileSync("ss", ["-tnp"], { encoding: "utf8", timeout: 2_000 });
    return parseSsOutput(out, pid);
  } catch {
    return null;
  }
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
 * Assert that `closeWaitCount` from a post-test snapshot is below the
 * threshold (DoD: ≤ 5 for 1000 concurrent SSE). Throws when the platform
 * supports ss AND the threshold is breached; no-op when ss is unavailable.
 */
export function assertNoLingeringCloseWait(
  snapshot: SocketSnapshot | null,
  threshold: number = 5,
): void {
  if (snapshot === null) return;
  if (snapshot.closeWaitCount > threshold) {
    throw new Error(
      `socket-monitor: ${snapshot.closeWaitCount} CLOSE_WAIT sockets remain for pid ${snapshot.pid} (threshold ${threshold}). Leak suspected.`,
    );
  }
}
