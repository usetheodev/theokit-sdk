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
