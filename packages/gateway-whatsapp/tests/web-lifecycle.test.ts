/**
 * Lifecycle tests (T3.1 + EC-5 cmdline guard).
 *
 * These tests use a controllable subprocess: a small `node` invocation that
 * sleeps for the test duration and exits cleanly. The cmdline-check is the
 * critical security path — if it fails, we'd kill unrelated processes.
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acquirePidLock,
  BRIDGE_PROCESS_TAG,
  pidBelongsToOurBridge,
} from "../src/backend/web/lifecycle.js";

let tmpHome: string;
const cleanups: Array<() => void> = [];

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "wa-test-"));
});

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/** Spawn a sleeper process. `includeTag` puts our BRIDGE_PROCESS_TAG into argv. */
function spawnSleeper(includeTag: boolean): ChildProcess {
  // Write a tiny sleeper script to a temp file (avoids `-e` swallowing args).
  const scriptPath = path.join(tmpHome, includeTag ? "sleeper-tagged.mjs" : "sleeper-untagged.mjs");
  fs.writeFileSync(scriptPath, "setTimeout(() => {}, 30000);\n");
  // Pass the tag as a script arg — Node forwards everything after the script path
  // to process.argv, and /proc/<pid>/cmdline sees the full vector.
  const args = [scriptPath];
  if (includeTag) args.push("--tag", BRIDGE_PROCESS_TAG);
  const child = spawn("node", args, { stdio: "ignore", detached: false });
  cleanups.push(() => {
    try {
      if (!child.killed) child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  });
  return child;
}

describe("pidBelongsToOurBridge (EC-5)", () => {
  it("returns true for a process whose cmdline contains the tag", async () => {
    const child = spawnSleeper(true);
    // Wait for process to be visible in /proc.
    await new Promise((r) => setTimeout(r, 50));
    expect(child.pid).toBeDefined();
    const ours = pidBelongsToOurBridge(child.pid!);
    expect(ours).toBe(true);
  });

  it("returns false for a process without the tag (DOES NOT kill arbitrary PIDs)", async () => {
    const child = spawnSleeper(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(child.pid).toBeDefined();
    const ours = pidBelongsToOurBridge(child.pid!);
    expect(ours).toBe(false);
  });

  it("returns false for a non-existent PID", () => {
    expect(pidBelongsToOurBridge(999_999)).toBe(false);
  });
});

describe("acquirePidLock", () => {
  it("test_acquire_pid_lock_creates_file", () => {
    const lock = acquirePidLock("session-a", tmpHome);
    expect(lock).toBe(path.join(tmpHome, "whatsapp-bridge-session-a.pid"));
    // File should NOT exist after acquire (we cleaned up).
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("test_acquire_pid_lock_kills_stale_process — pre-existing PID (cmdline matches) → killed", async () => {
    const child = spawnSleeper(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(child.pid).toBeDefined();
    const lockPath = path.join(tmpHome, "whatsapp-bridge-session-b.pid");
    fs.writeFileSync(lockPath, String(child.pid));

    acquirePidLock("session-b", tmpHome);

    // The process should be terminated (or in the process of terminating).
    await new Promise((r) => setTimeout(r, 200));
    // Either exited or signal received.
    expect(child.killed || child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it("test_acquire_pid_lock_preserves_unrelated_pid (EC-5) — non-bridge cmdline NOT killed", async () => {
    const child = spawnSleeper(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(child.pid).toBeDefined();
    const lockPath = path.join(tmpHome, "whatsapp-bridge-session-c.pid");
    fs.writeFileSync(lockPath, String(child.pid));

    acquirePidLock("session-c", tmpHome);

    // Process should STILL be alive (we did NOT kill it).
    await new Promise((r) => setTimeout(r, 200));
    expect(child.killed).toBe(false);
    expect(child.exitCode).toBeNull();
    // Stale file removed regardless.
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
