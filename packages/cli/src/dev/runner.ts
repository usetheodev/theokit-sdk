/**
 * Spawn `tsx --watch` against the resolved entry (T4.1, ADR D197).
 *
 * @internal
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/** Input for {@link startRunner}. */
interface RunnerOptions {
  /** Absolute path to the file tsx should load. */
  entry: string;
  /** Working directory for the child, and the root `envFile` is resolved against. */
  cwd: string;
  /**
   * Env file passed to `tsx --env-file`, relative to `cwd`. Default `.env`.
   *
   * The flag is only added when the file EXISTS — a missing one (including a misspelled explicit
   * name) is skipped silently, so the child starts without those variables and nothing says so.
   */
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

/** `exited` resolves with the child's exit code, or `130` when it was killed by a signal. It never rejects. */
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

/**
 * Spawn `tsx` on `opts.entry` and return the child plus a promise for its exit code.
 *
 * Returns immediately — the caller awaits `exited`. The child gets this process's `env` verbatim and
 * `stdio` per `opts.stdio` (default `"inherit"`).
 *
 * Installs `SIGINT`/`SIGTERM` listeners on the CURRENT process that forward `SIGTERM` to the child
 * and `SIGKILL` it 5s later. Those listeners are never removed, so calling this repeatedly in one
 * process accumulates them (fine for the CLI, which spawns once; a caller that does not should keep
 * that in mind).
 *
 * @throws whatever `require.resolve("tsx/cli")` throws when tsx is missing from this package's
 * install — `theokit dev` turns that into exit 1 with a "run pnpm install" hint.
 */
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
