/**
 * `theokit dev` — run the project's entry under `tsx --watch` with stdio
 * forwarding and graceful shutdown (T4.1, ADR D197).
 *
 * @internal
 */

import pc from "picocolors";

import { resolveEntry } from "../dev/entry-resolver.js";
import { startRunner } from "../dev/runner.js";

export interface DevOptions {
  entry?: string;
  env?: string;
}

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
