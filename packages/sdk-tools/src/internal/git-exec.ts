/**
 * Execução de `git` para tools — o motor compartilhado por `git_diff` e `git_status`.
 *
 * M76 — promovido de `git-diff.ts`, onde era privado. Duplicá-lo em `git-status` seria duplicação de
 * CONHECIMENTO: o teto de stdout, o kill do grupo de processos no timeout e o mapeamento para erro
 * tipado são a MESMA regra para qualquer subcomando do git. Duas cópias divergiriam na primeira
 * correção, e o sintoma seria uma tool com timeout e outra que pendura o turno.
 */
import { spawn } from "node:child_process";

import { armTimeoutKill, attachChildSettlers } from "../subprocess.js";

export function formatGitResult(result: GitProcessResult, timeoutMs: number): string {
  if (result.kind === "timeout") {
    return JSON.stringify({ ok: false, error: "timeout", timeoutMs });
  }
  if (result.kind === "error") {
    return JSON.stringify({ ok: false, error: "git_failed", stderr: result.stderr });
  }
  return JSON.stringify({ ok: true, diff: result.stdout, truncated: result.truncated });
}

type GitProcessResult =
  | { kind: "ok"; stdout: string; truncated: boolean }
  | { kind: "error"; stderr: string }
  | { kind: "timeout" };

export function runGitProcess(
  cwd: string,
  args: string[],
  timeoutMs: number,
  maxStdoutBytes: number,
): Promise<GitProcessResult> {
  return new Promise((resolve) => {
    // Detached process group so we can kill the whole tree on timeout (EC-7).
    const child = spawn("git", args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let truncated = false;

    const gate = armTimeoutKill<GitProcessResult>(
      child,
      timeoutMs,
      () => ({ kind: "timeout" }),
      resolve,
    );

    child.stdout.on("data", (chunk: Buffer) => {
      if (gate.settled()) return;
      if (stdoutBytes >= maxStdoutBytes) {
        truncated = true;
        return;
      }
      const remaining = maxStdoutBytes - stdoutBytes;
      if (chunk.length > remaining) {
        stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes = maxStdoutBytes;
        truncated = true;
      } else {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    attachChildSettlers<GitProcessResult>(
      child,
      gate,
      (code) => {
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");
        return code === 0 ? { kind: "ok", stdout, truncated } : { kind: "error", stderr };
      },
      (err) => ({ kind: "error", stderr: err.message }),
      resolve,
    );
  });
}
