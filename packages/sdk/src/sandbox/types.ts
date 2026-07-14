/**
 * Sandbox backend protocol — pluggable execution environment for agent tools.
 *
 * Per ADR D1: only 2 abstract methods (`execute` + `uploadFile`). All
 * higher-level operations are derived on the base class. New backends
 * (Docker, Firecracker, E2B) only implement those 2 methods.
 *
 * @public
 */

import { shellEscapePosix } from "./shell-escape.js";

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface SandboxConfig {
  workDir?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /**
   * #54 — env inherit/scrub policy for the executed command's child process.
   * Defaults to `"inherit-scrubbed"` (drop secret-like vars: `*KEY*`, `*SECRET*`,
   * `*TOKEN*`, `*PASSWORD*`, `*_AUTH*`). Pass `"all"` to restore full inheritance
   * or `"core"` for a minimal safe allowlist.
   */
  env?: import("../internal/runtime/lifecycle/env-policy.js").EnvPolicy;
}

export class SandboxSecurityError extends Error {
  readonly code = "sandbox_security" as const;
  constructor(message: string) {
    super(message);
    this.name = "SandboxSecurityError";
  }
}

export class SandboxNotAvailableError extends Error {
  readonly code = "sandbox_not_available" as const;
  constructor(message: string) {
    super(message);
    this.name = "SandboxNotAvailableError";
  }
}

export abstract class SandboxBackend {
  protected config: SandboxConfig;

  constructor(config: SandboxConfig = {}) {
    this.config = {
      workDir: config.workDir ?? "/tmp",
      timeoutMs: config.timeoutMs ?? 30_000,
      maxOutputBytes: config.maxOutputBytes ?? 5 * 1024 * 1024,
      // #54 — preserve the env policy so backends can scrub secrets.
      env: config.env ?? "inherit-scrubbed",
    };
  }

  abstract execute(command: string, opts?: { timeoutMs?: number }): Promise<ExecuteResult>;

  abstract uploadFile(path: string, content: string | Buffer): Promise<void>;

  async readFile(path: string): Promise<string> {
    const result = await this.execute(`cat ${this.shellEscape(path)}`);
    if (result.exitCode !== 0) {
      throw new Error(`readFile failed: ${result.stderr}`);
    }
    return result.stdout;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.uploadFile(path, content);
  }

  async glob(pattern: string, cwd?: string): Promise<string[]> {
    const dir = cwd ?? this.config.workDir ?? ".";
    const result = await this.execute(
      `find ${this.shellEscape(dir)} -name ${this.shellEscape(pattern)} -type f 2>/dev/null`,
    );
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split("\n").filter(Boolean);
  }

  async grep(pattern: string, path?: string): Promise<string[]> {
    const target = path ?? ".";
    const result = await this.execute(
      `grep -rn ${this.shellEscape(pattern)} ${this.shellEscape(target)} 2>/dev/null`,
    );
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split("\n").filter(Boolean);
  }

  async listDir(path: string): Promise<string[]> {
    const result = await this.execute(`ls -1 ${this.shellEscape(path)}`);
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split("\n").filter(Boolean);
  }

  protected truncateOutput(output: string): string {
    const max = this.config.maxOutputBytes ?? 5 * 1024 * 1024;
    if (Buffer.byteLength(output) > max) {
      return `${output.slice(0, max)}\n...(truncated)`;
    }
    return output;
  }

  private shellEscape(arg: string): string {
    return shellEscapePosix(arg);
  }
}
