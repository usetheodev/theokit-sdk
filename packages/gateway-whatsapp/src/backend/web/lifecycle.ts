/**
 * Bridge subprocess lifecycle (ADR D305, D313). PID file lock + stale-process
 * cleanup. EC-5 absorbed: verifies cmdline before killing (otherwise we may
 * kill an unrelated process the OS recycled the PID for).
 *
 * @internal
 */

import { type ChildProcess, execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** Marker substring our bridge process MUST carry in its argv (EC-5). */
export const BRIDGE_PROCESS_TAG = "whatsapp-web-bridge";

export interface SpawnBridgeOptions {
  readonly sessionId: string;
  readonly bridgeScriptPath: string;
  readonly theokitHome?: string;
}

export interface BridgeHandle {
  readonly child: ChildProcess;
  readonly pidFilePath: string;
}

function pidFilePath(theokitHome: string, sessionId: string): string {
  return path.join(theokitHome, `whatsapp-bridge-${sessionId}.pid`);
}

function defaultTheokitHome(): string {
  return process.env.THEOKIT_HOME ?? path.join(process.env.HOME ?? "/tmp", ".theokit");
}

/**
 * Verify whether `pid` belongs to a process whose argv contains our tag (EC-5).
 *
 * Without this guard, OS may have recycled the PID to e.g. `vim` and our
 * cleanup would terminate the user's editor.
 *
 * @internal
 */
export function pidBelongsToOurBridge(pid: number): boolean {
  try {
    // Linux: /proc/<pid>/cmdline (NUL-separated argv).
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    return cmdline.includes(BRIDGE_PROCESS_TAG);
  } catch {
    // macOS / BSD fallback: ps -p <pid> -o args=
    try {
      const out = execSync(`ps -p ${pid} -o args=`, {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString();
      return out.includes(BRIDGE_PROCESS_TAG);
    } catch {
      return false;
    }
  }
}

/**
 * Acquire the PID lock for a session — kill any stale bridge (cmdline-verified),
 * then return the lock-file path (caller writes its own PID after spawn).
 */
export function acquirePidLock(sessionId: string, theokitHome?: string): string {
  const home = theokitHome ?? defaultTheokitHome();
  fs.mkdirSync(home, { recursive: true });
  const lockFile = pidFilePath(home, sessionId);

  if (fs.existsSync(lockFile)) {
    const raw = fs.readFileSync(lockFile, "utf8").trim();
    const stalePid = Number.parseInt(raw, 10);
    if (Number.isFinite(stalePid) && stalePid > 0) {
      // EC-5: ONLY kill if cmdline confirms ownership.
      if (pidBelongsToOurBridge(stalePid)) {
        try {
          process.kill(stalePid, "SIGTERM");
        } catch {
          // Process already gone — fine.
        }
      }
      // If cmdline doesn't match, we silently overwrite the file — we don't
      // touch the foreign process.
    }
    try {
      fs.unlinkSync(lockFile);
    } catch {
      /* ignore */
    }
  }
  return lockFile;
}

/** Spawn the bridge subprocess, write PID file. */
export function spawnBridge(opts: SpawnBridgeOptions): BridgeHandle {
  const home = opts.theokitHome ?? defaultTheokitHome();
  const lockFile = acquirePidLock(opts.sessionId, home);

  const child = spawn(
    "node",
    [opts.bridgeScriptPath, "--tag", BRIDGE_PROCESS_TAG, "--session", opts.sessionId],
    {
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    },
  );

  if (child.pid !== undefined) {
    fs.writeFileSync(lockFile, String(child.pid), { mode: 0o600 });
  }

  // EC-12: pipe stderr so the buffer never fills.
  if (child.stderr !== null) {
    child.stderr.pipe(process.stderr);
  }

  return { child, pidFilePath: lockFile };
}

/** Terminate the bridge: SIGTERM → wait 3s → SIGKILL. Removes PID file. */
export async function terminateBridge(handle: BridgeHandle): Promise<void> {
  const { child, pidFilePath: lockFile } = handle;
  if (child.pid !== undefined && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    const exited = await waitForExit(child, 3000);
    if (!exited) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      await waitForExit(child, 1000);
    }
  }
  try {
    fs.unlinkSync(lockFile);
  } catch {
    /* ignore */
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    let resolved = false;
    const onExit = () => {
      if (resolved) return;
      resolved = true;
      resolve(true);
    };
    child.once("exit", onExit);
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs).unref();
  });
}
