import { InteractiveUnavailableError, NoSuchSessionError } from "@theokit/sdk/interactive";
import { afterEach, describe, expect, it } from "vitest";

import {
  clampYield,
  PtyInteractiveBackend,
  YIELD_MAX_MS,
  YIELD_MIN_MS,
} from "../src/pty-interactive-backend.js";

// These tests spawn REAL PTYs (integration-grade). Skipped automatically when node-pty's native build
// is unavailable (CI without a toolchain).
const probe = new PtyInteractiveBackend();
const hasPty = probe.available();
const d = hasPty ? describe : describe.skip;

let backend: PtyInteractiveBackend;
afterEach(() => {
  backend?.killAll();
});

d("PtyInteractiveBackend (real PTY)", () => {
  it("starts a session and returns a session id", async () => {
    backend = new PtyInteractiveBackend();
    const { sessionId, output } = await backend.startInteractive("cat", { yieldMs: 300 });
    expect(sessionId).toMatch(/.+/);
    expect(typeof output).toBe("string");
  });

  it("writes stdin and reads the echoed output back", async () => {
    backend = new PtyInteractiveBackend();
    const { sessionId } = await backend.startInteractive("cat", { yieldMs: 300 });
    const { output, alive } = await backend.writeStdin(sessionId, "ping-123\n", { yieldMs: 400 });
    expect(output).toContain("ping-123");
    expect(alive).toBe(true);
  });

  it("rejects a write to a killed session with a TYPED NoSuchSessionError", async () => {
    backend = new PtyInteractiveBackend();
    const { sessionId } = await backend.startInteractive("cat", { yieldMs: 300 });
    backend.kill(sessionId);
    await expect(backend.writeStdin(sessionId, "x\n", { yieldMs: 300 })).rejects.toBeInstanceOf(
      NoSuchSessionError,
    );
  });

  it("kill reaps a DETACHED grandchild (process-group kill, not just the shell)", async () => {
    backend = new PtyInteractiveBackend();
    const { sessionId, output } = await backend.startInteractive("sleep 300 & echo PID=$!; wait", {
      yieldMs: 600,
    });
    const gpid = Number(/PID=(\d+)/.exec(output)?.[1] ?? 0);
    expect(gpid).toBeGreaterThan(0);
    expect(() => process.kill(gpid, 0)).not.toThrow(); // alive before kill
    backend.kill(sessionId);

    // B-020. Was a flat 300ms bet that the kernel had reaped the group by then.
    await waitUntil(() => isReaped(gpid), `the detached grandchild (pid ${gpid}) to be reaped`);

    expect(() => process.kill(gpid, 0), "the whole process group must be gone").toThrow();
  });

  it("an idle session is reaped by its TTL", async () => {
    backend = new PtyInteractiveBackend();
    await backend.startInteractive("cat", { yieldMs: 200, ttlMs: 400 });
    expect(backend.activeSessionCount()).toBe(1);

    // B-021. Was 650ms for a 400ms TTL — a 250ms margin covering both the timer AND the PTY exit it
    // triggers. The TTL itself is a JS `setTimeout` (pty-interactive-backend.ts:231), so fake timers
    // would drive it; the process teardown it fires is not, so faking the clock would prove the
    // timer fired and nothing about the session actually closing. Polling covers both halves.
    await waitUntil(
      () => backend.activeSessionCount() === 0,
      "the idle session to be reaped by its TTL",
    );

    expect(backend.activeSessionCount(), "the TTL must close the session").toBe(0);
  });

  it("a spawn-time failure (bad cwd) degrades to a TYPED InteractiveUnavailableError", async () => {
    backend = new PtyInteractiveBackend();
    await expect(
      backend.startInteractive("cat", { cwd: "/no/such/dir/xyzzy", yieldMs: 200 }),
    ).rejects.toBeInstanceOf(InteractiveUnavailableError);
  });

  it("serializes concurrent writes — each reads its OWN output window", async () => {
    backend = new PtyInteractiveBackend();
    const { sessionId } = await backend.startInteractive("cat", { yieldMs: 300 });
    const a = backend.writeStdin(sessionId, "AAA\n", { yieldMs: 300 });
    const b = backend.writeStdin(sessionId, "BBB\n", { yieldMs: 300 });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.output).toContain("AAA");
    expect(ra.output).not.toContain("BBB");
    expect(rb.output).toContain("BBB");
  });
});

/**
 * Polls `check` until it holds, or fails with a message naming what never happened.
 *
 * B-020/B-021. These two waits are the ONE case in the sleep-sync family that fake timers cannot
 * help with: the events are a kernel process-group reap and a PTY exit, and no JS timer is involved.
 * A fixed sleep here is a bet that the OS is done within N ms — 300ms for a reap, 650ms for a 400ms
 * TTL. Both are silently wrong in two directions: too short flakes under load, too long is paid on
 * every run forever, and neither number is derivable from anything.
 *
 * Polling states the real contract — "this becomes true, within a deadline" — and reports which half
 * failed. The deadline is a failure bound, not a synchroniser.
 *
 * The default MUST stay below vitest's own `testTimeout`, or the descriptive error is unreachable:
 * this package sets no `testTimeout`, so vitest's default is 5000ms. My first version used 5000 here
 * too — and since the clock starts AFTER setup (`startInteractive` yields 200-600ms), vitest always
 * won the race. Measured under both mutants: `Test timed out in 5000ms`, and the string this helper
 * exists to print never appeared once. A deadline that cannot fire is a comment, not a bound.
 */
async function waitUntil(
  check: () => boolean,
  description: string,
  { timeoutMs = 3_000, everyMs = 10 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for: ${description}`);
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/** True once `pid` is gone — `kill(pid, 0)` throws ESRCH for a reaped process. */
function isReaped(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

describe("clampYield (pure)", () => {
  it("clamps an absurd yield down to the max", () => {
    expect(clampYield(999_999)).toBe(YIELD_MAX_MS);
  });
  it("clamps a tiny yield up to the min", () => {
    expect(clampYield(1)).toBe(YIELD_MIN_MS);
  });
  it("passes an in-range yield through", () => {
    expect(clampYield(1000)).toBe(1000);
  });
});
