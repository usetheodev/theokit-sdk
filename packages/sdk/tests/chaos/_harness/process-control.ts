/**
 * Process-control chaos harness (T0.3, ADR D37 methodology).
 *
 * Spawns child Node processes for chaos scenarios where mid-stream SIGKILL
 * is the entire test invariant. Returns typed handles so test code can
 * coordinate stream-state observation + signal injection without resorting
 * to `child_process.spawn` boilerplate everywhere.
 *
 * Used by `tests/chaos/kill-mid-stream.test.ts` (T0.3 scaffold) and later
 * by `tests/chaos/oom-recovery.test.ts` (T6.5).
 *
 * @internal
 */

import { type ChildProcess, spawn } from "node:child_process";

export interface ChildHandle {
  child: ChildProcess;
  pid: number;
  /** stdout lines captured chronologically. */
  readonly stdoutLines: ReadonlyArray<string>;
  /** stderr lines captured chronologically. */
  readonly stderrLines: ReadonlyArray<string>;
  /** Resolves with the exit code (null if killed by signal). */
  exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export interface SpawnOptions {
  /** Node interpreter args (e.g. `--max-old-space-size=128`). */
  nodeArgs?: string[];
  /** Script path the child should execute. */
  scriptPath: string;
  /** Arguments passed to the child script. */
  args?: string[];
  /** Env overrides. */
  env?: Record<string, string>;
}

/**
 * Spawn a Node child with stdout/stderr captured to in-memory arrays.
 * The caller MUST eventually `await handle.exitPromise` OR kill the child
 * via `killMidStream` so the process does not leak.
 */
export function spawnNodeChild(opts: SpawnOptions): ChildHandle {
  const stdoutBuf: string[] = [];
  const stderrBuf: string[] = [];
  const child = spawn(
    process.execPath,
    [...(opts.nodeArgs ?? []), opts.scriptPath, ...(opts.args ?? [])],
    { env: { ...process.env, ...(opts.env ?? {}) } },
  );
  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.length > 0) stdoutBuf.push(line);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.length > 0) stderrBuf.push(line);
    }
  });
  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  return {
    child,
    pid: child.pid ?? -1,
    stdoutLines: stdoutBuf,
    stderrLines: stderrBuf,
    exitPromise,
  };
}

/**
 * Send SIGKILL to a child mid-stream. Waits up to `timeoutMs` for the
 * process to exit; returns the exit information. The harness asserts that
 * the parent process did NOT crash in response to the child death (the
 * canonical chaos invariant per ADR D37).
 */
export async function killMidStream(
  handle: ChildHandle,
  timeoutMs: number = 5_000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (handle.child.killed) return handle.exitPromise;
  handle.child.kill("SIGKILL");
  const timeoutPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) =>
      setTimeout(
        () => resolve({ code: null, signal: "SIGKILL" as NodeJS.Signals }),
        timeoutMs,
      ),
  );
  return Promise.race([handle.exitPromise, timeoutPromise]);
}

/** Wait for a line matching `predicate` to appear in stdout. */
export function waitForStdout(
  handle: ChildHandle,
  predicate: (line: string) => boolean,
  timeoutMs: number = 10_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      const found = handle.stdoutLines.find(predicate);
      if (found !== undefined) {
        clearInterval(t);
        resolve(found);
      }
    }, 50);
    setTimeout(() => {
      clearInterval(t);
      reject(new Error(`waitForStdout timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}
