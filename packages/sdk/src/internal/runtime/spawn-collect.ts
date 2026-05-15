import { type SpawnOptions, spawn } from "node:child_process";

/**
 * Shared `child_process.spawn` wrapper that collects stdout/stderr text and
 * enforces a timeout via SIGKILL. Used by both the hooks executor and the
 * shell tool so each spawn path doesn't reinvent the buffer + timer dance.
 *
 * @internal
 */

export interface SpawnCollectOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  stdin?: string;
}

export interface SpawnCollectResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  spawnError?: Error;
}

export function spawnAndCollect(options: SpawnCollectOptions): Promise<SpawnCollectResult> {
  return new Promise<SpawnCollectResult>((resolve) => {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
    };
    const child = spawn(options.command, options.args ?? [], spawnOptions);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const settle = (result: SpawnCollectResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // child may already have exited
      }
      settle({ stdout, stderr, exitCode: null, timedOut: true });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (cause) => {
      clearTimeout(timer);
      settle({ stdout, stderr, exitCode: -1, timedOut, spawnError: cause });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      settle({ stdout, stderr, exitCode: code, timedOut });
    });
    if (options.stdin !== undefined && child.stdin !== null) {
      child.stdin.end(options.stdin);
    }
  });
}
