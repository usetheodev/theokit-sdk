import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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

// `kill(-pid)` addresses a process GROUP, which is a POSIX concept; on win32 it throws EINVAL and
// the backend falls back to `pty.kill()`. The group-kill case below is guarded rather than left to
// fail there, and CI runs ubuntu only.
const POSIX = process.platform !== "win32";

let backend: PtyInteractiveBackend;

/**
 * Pids spawned OUTSIDE the backend's bookkeeping — a grandchild that deliberately survives the PTY
 * hangup is, by construction, one `killAll()` cannot be relied on to reap. Registered here so the
 * FAILURE path cleans up too: the test that registers it fails precisely when the process is still
 * alive, which is exactly when leaking it would cost something.
 */
const escapedPids: number[] = [];

afterEach(() => {
  backend?.killAll();
  for (const pid of escapedPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already reaped — the expected case when the test passed
    }
  }
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

  /**
   * B-100. This test replaces one named `kill reaps a DETACHED grandchild (process-group kill, not
   * just the shell)` whose grandchild was a plain `sleep 300 &`. That name claimed the minus sign in
   * `process.kill(-session.pty.pid, "SIGKILL")` was the mechanism, and the oracle did not constrain
   * it. Measured, three mutants of that line:
   *
   * | Mutant | Old test |
   * |---|---|
   * | `process.kill(session.pty.pid, …)` — drop the `-`, kill the leader only | **passed** |
   * | `session.pty.kill()` — node-pty's own kill, `SIGHUP` to the leader | **passed** |
   * | remove the kill entirely | failed |
   *
   * A plain background child dies whichever way the leader is killed, because closing the PTY master
   * hangs up the terminal and the kernel sends `SIGHUP` to the foreground process group. So the old
   * test proved the grandchild was gone and nothing about WHY — the group kill was doing no work the
   * hangup was not already doing. That is also environment-shaped: on a platform whose teardown does
   * not hang up, the same green would have been hiding a real leak.
   *
   * Isolating the property needs a grandchild that survives everything EXCEPT the group kill.
   * `(trap '' HUP; exec sleep 300) &` is that: the subshell sets `SIGHUP` to ignore and then `exec`s
   * in place, and POSIX keeps ignored dispositions across `exec` (only caught ones reset), so the
   * `sleep` is immune to the hangup while keeping the pid `$!` reported. It stays in the SHELL's
   * process group — `sh -c` runs without job control, so a background job is not given a group of
   * its own — which is what makes `kill(-pid)` reach it and `kill(pid)` miss it.
   *
   * The old test is replaced rather than kept alongside: what it protected was the kernel's hangup
   * behaviour, not a line of ours, and a suite is not better for holding a test whose green is
   * independent of the code it names.
   */
  it.skipIf(!canReadProcessGroup)(
    "kill reaps a SIGHUP-immune grandchild — only the process-GROUP kill can reach it",
    async () => {
      backend = new PtyInteractiveBackend();
      const { sessionId, output } = await backend.startInteractive(
        "(trap '' HUP; exec sleep 300) & echo PID=$!; echo LEADER=$$; wait",
        { yieldMs: 600 },
      );
      const grandchild = Number(/PID=(\d+)/.exec(output)?.[1] ?? 0);
      const leader = Number(/LEADER=(\d+)/.exec(output)?.[1] ?? 0);
      expect(grandchild, "the shell must report the backgrounded pid").toBeGreaterThan(0);
      expect(leader, "the shell must report its own pid").toBeGreaterThan(0);
      escapedPids.push(grandchild);
      expect(isReaped(grandchild), "the grandchild must be alive before the kill").toBe(false);

      // The arrange assertion that NAMES the mechanism. `kill(-leader)` reaches this process for one
      // reason only: it shares the PTY leader's process group. If a future change gave the
      // grandchild a session of its own, the group kill would stop being why it dies and this test
      // would quietly start measuring something else — so the premise is asserted, not assumed.
      expect(
        processGroupOf(grandchild),
        "the grandchild must sit in the PTY leader's process group — that is what kill(-pid) reaches",
      ).toBe(leader);

      backend.kill(sessionId);

      // B-020. Was a flat 300ms bet that the kernel had reaped the group by then.
      await waitUntil(
        () => isReaped(grandchild),
        `the SIGHUP-immune grandchild (pid ${grandchild}) to be reaped by the process-group kill`,
      );

      expect(
        isReaped(grandchild),
        "a SIGHUP-immune grandchild survives killing the leader and the PTY hangup; only kill(-pid) on the GROUP reaps it",
      ).toBe(true);
    },
  );

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

/**
 * The process group of `pid`, as the OS reports it.
 *
 * Deliberately an OS read rather than an inference: the assertion that uses it exists to establish
 * that the grandchild's GROUP membership is what makes the group kill reach it, and deriving that
 * membership from the same assumption the test is checking would assert nothing.
 *
 * `/proc/<pid>/stat` is tried first because on Linux — where CI runs — it needs no external binary,
 * so the test does not acquire a dependency on `procps` merely to state its own premise. `ps` is the
 * fallback for platforms without `/proc` (macOS, the BSDs).
 *
 * A first version used `ps` alone and let a missing binary FAIL the case, reasoning that a test
 * unable to establish its premise must not slide past it. That reasoning is sound in isolation and
 * wrong in context: it invents a second policy for absent tooling inside a file whose very first
 * decision is `const d = hasPty ? describe : describe.skip` — an environmental capability that is
 * missing SKIPS here, visibly. A red that is not a defect is the thing that teaches people to ignore
 * reds. {@link canReadProcessGroup} probes the capability once, the same shape and for the same
 * reason.
 */
function readProcessGroup(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    // `comm` is parenthesised and may itself contain spaces or ')', so the numeric fields are
    // counted from the LAST ')': [state, ppid, pgrp, …]. `pgrp` is the third.
    const fields = stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(/\s+/);
    const fromProc = Number(fields[2]);
    if (Number.isInteger(fromProc) && fromProc > 0) return fromProc;
  } catch {
    // No `/proc` (macOS/BSD), or the process was reaped between the check and the read. Both are
    // handled by the `ps` fallback below rather than by guessing.
  }
  try {
    const raw = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim();
    const fromPs = Number(raw);
    if (Number.isInteger(fromPs) && fromPs > 0) return fromPs;
  } catch {
    // `ps` absent (a slim container without procps) — reported as an absent capability, not a value.
  }
  return undefined;
}

/** Whether this machine can report a process group at all — probed once, like `hasPty` above. */
const canReadProcessGroup = POSIX && readProcessGroup(process.pid) !== undefined;

/** {@link readProcessGroup}, as a value or a failure. Used only where the capability was gated on. */
function processGroupOf(pid: number): number {
  const pgid = readProcessGroup(pid);
  if (pgid === undefined) {
    throw new Error(`neither /proc nor ps could report a process group for pid ${String(pid)}`);
  }
  return pgid;
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
