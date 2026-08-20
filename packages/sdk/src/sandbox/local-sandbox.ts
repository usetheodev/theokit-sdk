/**
 * LocalSandbox — subprocess-based execution. **This is NOT an isolation
 * boundary.** It runs the command via `/bin/sh -c` in the SAME OS as the host
 * with the host's filesystem and network fully reachable — it provides NO
 * process, filesystem, or network isolation. Its only safety affordances are:
 *   - a wall-clock timeout (kills a runaway command),
 *   - an output-size cap (bounds memory), and
 *   - env scrubbing (#54): secret-like parent env vars (`*KEY*`/`*SECRET*`/
 *     `*TOKEN*`/`*PASSWORD*`/`*_AUTH*`) are dropped from the child by default
 *     (`SandboxConfig.env`), so a shell tool cannot exfiltrate host secrets via
 *     the environment.
 *
 * For real isolation (untrusted code), use a container/VM backend — NOT this.
 *
 * @public
 */

import { execFile } from "node:child_process";
import { writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { resolveChildEnv } from "../internal/runtime/lifecycle/env-policy.js";
import { type ExecuteResult, SandboxBackend, type SandboxConfig } from "./types.js";

/**
 * Runs a command with `/bin/sh -c` on the host. NOT an isolation boundary — the
 * module note above states exactly what it does and does not protect.
 *
 *   const sandbox = new LocalSandbox({ workDir: "/srv/repo", timeoutMs: 10_000 });
 *   const { stdout, exitCode, timedOut } = await sandbox.execute("ls -1");
 *
 * Needs a POSIX host with `/bin/sh`. Every helper inherited from
 * {@link SandboxBackend} — `readFile`, `glob`, `grep`, `listDir` — is built on
 * this `execute`, so they inherit that requirement too.
 *
 * How it fails: `execute` NEVER rejects. Every outcome, including a failure to
 * spawn, comes back as an {@link ExecuteResult}; read `timedOut` first
 * (`true` implies `exitCode` 124) and `stderr` for the reason. `uploadFile` DOES
 * reject, with the raw `node:fs` error, on a bad path or missing permission.
 *
 * Traps:
 *  - `exitCode` is not the child's exit code. It is 0, 124 (timed out) or 1 — a
 *    command that exits 3 is reported as 1, so branching on a specific code does
 *    not work here.
 *  - Output beyond `maxOutputBytes` (default 5 MiB) makes Node kill the child.
 *    The result is `exitCode: 1`, `timedOut: false`, and for plain ASCII output
 *    the buffer is cut exactly at the cap, so the `...(truncated)` marker
 *    described on `ExecuteResult` is NOT appended — a truncated stdout is
 *    indistinguishable from a complete one.
 *  - `uploadFile` resolves a relative path against `workDir` but does not contain
 *    it: an absolute path, or one containing `..`, writes wherever the process
 *    can. `workDir` is a starting directory, not a jail.
 *  - Secret-like parent env vars are dropped by default. Passing
 *    `env: "all"` in {@link SandboxConfig} puts the host's API keys back within
 *    reach of any command the agent runs.
 */
export class LocalSandbox extends SandboxBackend {
  constructor(config: SandboxConfig = {}) {
    super(config);
  }

  async execute(command: string, opts?: { timeoutMs?: number }): Promise<ExecuteResult> {
    const timeout = opts?.timeoutMs ?? this.config.timeoutMs ?? 30_000;
    const max = this.config.maxOutputBytes ?? 5 * 1024 * 1024;

    return new Promise<ExecuteResult>((resolve) => {
      const child = execFile(
        "/bin/sh",
        ["-c", command],
        {
          cwd: this.config.workDir,
          timeout,
          maxBuffer: max,
          encoding: "utf-8",
          // #54 — scrub secret-like host env vars from the child by default.
          env: resolveChildEnv({ policy: this.config.env }),
        },
        (error, stdout, stderr) => {
          resolve(this.buildResult(error, stdout ?? "", stderr ?? ""));
        },
      );

      // Safety: if child somehow doesn't callback
      child.on("error", () => {
        resolve({ stdout: "", stderr: "spawn error", exitCode: 1, timedOut: false });
      });
    });
  }

  private buildResult(error: Error | null, stdout: string, stderr: string): ExecuteResult {
    const timedOut = error !== null && "killed" in error && (error as { killed: boolean }).killed;
    return {
      stdout: this.truncateOutput(stdout),
      stderr: this.truncateOutput(stderr),
      exitCode: timedOut ? 124 : error ? 1 : 0,
      timedOut,
    };
  }

  async uploadFile(path: string, content: string | Buffer): Promise<void> {
    const fullPath = path.startsWith("/") ? path : `${this.config.workDir}/${path}`;
    await mkdir(dirname(fullPath), { recursive: true });
    await fsWriteFile(fullPath, content, "utf-8");
  }
}
