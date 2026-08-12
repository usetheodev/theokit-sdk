/**
 * Spawn `tsx --watch` against the resolved entry (T4.1, ADR D197).
 *
 * @internal
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

interface RunnerOptions {
  entry: string;
  cwd: string;
  envFile?: string;
  /** Pass `--watch` to tsx. Default true (production). Tests use false. */
  watch?: boolean;
  /**
   * How the child's streams are wired. Default `"inherit"` — `theokit dev` MUST show the child's
   * output, which is most of what the command is for.
   *
   * A test asserting the child's EXIT CODE does not want its output: with `inherit`, a deliberately
   * broken entry file makes tsx print a transform error onto the test worker's stderr, and CI reads
   * that as a failed run even though the case passed. Measured on `develop`: four validate legs red
   * with every test green.
   */
  stdio?: "inherit" | "ignore";
}

interface RunnerHandle {
  child: ChildProcess;
  exited: Promise<number>;
}

/**
 * Resolve the `tsx` CLI bin from CLI-package node_modules (NOT user's).
 * Ensures consistent tsx version regardless of consumer project state.
 */
function resolveTsxBin(): string {
  const require = createRequire(import.meta.url);
  // tsx exports the CLI under `./cli` (subpath); verified against
  // tsx@4.22 package.json exports.
  return require.resolve("tsx/cli");
}

export function startRunner(opts: RunnerOptions): RunnerHandle {
  const tsxBin = resolveTsxBin();
  const args: string[] = [];
  if (opts.watch !== false) args.push("--watch");
  const envFile = opts.envFile ?? ".env";
  const envFileAbs = join(opts.cwd, envFile);
  if (existsSync(envFileAbs)) {
    args.push("--env-file", envFile);
  }
  args.push(opts.entry);

  const child = spawn(process.execPath, [tsxBin, ...args], {
    cwd: opts.cwd,
    stdio: opts.stdio ?? "inherit",
    env: process.env,
  });

  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code, signal) => {
      resolve(code ?? (signal !== null ? 130 : 0));
    });
  });

  // Forward SIGINT / SIGTERM gracefully. Give child 5s to clean up, then
  // SIGKILL.
  let killTimer: NodeJS.Timeout | undefined;
  const forward = (sig: NodeJS.Signals): void => {
    if (child.killed) return;
    child.kill(sig);
    killTimer = setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 5000);
    killTimer.unref();
  };
  process.on("SIGINT", () => forward("SIGTERM"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  // Clear the kill timer once the child exits.
  child.on("exit", () => {
    if (killTimer !== undefined) clearTimeout(killTimer);
  });

  return { child, exited };
}
