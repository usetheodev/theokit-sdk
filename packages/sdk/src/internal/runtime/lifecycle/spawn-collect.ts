import { type SpawnOptions, spawn } from "node:child_process";
import { type EnvPolicy, resolveChildEnv } from "./env-policy.js";

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
  /**
   * #54 — env inherit/scrub policy for the child. Defaults to
   * `inherit-scrubbed` (drop secret-like vars). `env` above is merged AFTER the
   * policy and always wins. Pass `"all"` to restore full inheritance.
   */
  envPolicy?: EnvPolicy;
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
      // #54 — scrub secret-like parent env by default; `options.env` still wins.
      env: resolveChildEnv({ policy: options.envPolicy, overrides: options.env }),
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
      // A child that exits without reading its stdin — `exit 1`, a hook that only checks the
      // environment, any command that ignores the payload — closes the pipe first, and the write
      // then raises EPIPE on the stream. Unhandled, that is an uncaught exception in the SDK's own
      // process, from a child behaving perfectly legitimately.
      //
      // Swallowed rather than surfaced: the child's exit code and stderr are the result, and they
      // are collected either way. A payload nobody read is not a failure of the spawn.
      child.stdin.on("error", () => {});
      child.stdin.end(options.stdin);
    }
  });
}
