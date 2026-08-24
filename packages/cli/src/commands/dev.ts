/**
 * `theokit dev` — run the project's entry under `tsx --watch` with stdio
 * forwarding and graceful shutdown (T4.1, ADR D197).
 *
 * Exit codes: `2` when no entry file can be resolved; `1` when `tsx` cannot be spawned; otherwise
 * the CHILD process's exit code, so a crashing agent makes `theokit dev` exit non-zero for reasons
 * that have nothing to do with the CLI.
 *
 * @internal
 */

import pc from "picocolors";

import { resolveEntry } from "../dev/entry-resolver.js";
import { startRunner } from "../dev/runner.js";

/** Flags for {@link runDev}. */
export interface DevOptions {
  /** Entry file. Default: `package.json` `main`, then `src/index.ts` and siblings. */
  entry?: string;
  /**
   * Env file passed to `tsx --env-file`, relative to cwd. Default `.env`.
   *
   * Silently skipped when the file does not exist — including a `--env` you named yourself, so a
   * typo looks exactly like "my variables are not loading".
   */
  env?: string;
}

/**
 * Resolve the entry, spawn `tsx --watch` on it, and block until that child exits.
 *
 * The child inherits this process's stdio and environment, and `SIGINT`/`SIGTERM` are forwarded to
 * it as `SIGTERM` with a 5s grace period before `SIGKILL`. `tsx` comes from THIS package's
 * `node_modules`, not the project's, so the version is fixed regardless of the consumer's lockfile.
 *
 * @returns 2 for an unresolvable entry, 1 when the spawn fails, otherwise the child's exit code
 * (130 when it died from a signal).
 */
export async function runDev(opts: DevOptions): Promise<number> {
  let entry: string;
  try {
    entry = resolveEntry(process.cwd(), opts.entry);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code ?? "unknown";
    process.stderr.write(`${pc.red("error:")} ${message}\n  ${pc.gray(`(code: ${code})`)}\n`);
    return code === "entry_not_found" ? 2 : 1;
  }

  process.stdout.write(`${pc.cyan("[dev]")} watching ${pc.bold(entry)} — Ctrl+C to stop.\n`);

  let handle: ReturnType<typeof startRunner>;
  try {
    handle = startRunner({
      entry,
      cwd: process.cwd(),
      ...(opts.env !== undefined ? { envFile: opts.env } : {}),
    });
  } catch (err) {
    process.stderr.write(
      `${pc.red("error:")} could not spawn tsx — ${err instanceof Error ? err.message : String(err)}\n` +
        `  ${pc.gray("Hint: try `pnpm install` to repair @theokit/cli.")}\n`,
    );
    return 1;
  }

  const exitCode = await handle.exited;
  return exitCode;
}
