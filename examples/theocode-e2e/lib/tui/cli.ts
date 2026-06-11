/**
 * CLI argument parser and entry point for TheoCode TUI.
 *
 * `main()` is the programmatic entry; the bin stub just calls it with
 * `process.argv.slice(2)`.
 */

export interface CliOptions {
  model?: string;
  session?: string;
  projectRoot?: string;
}

/**
 * Parse raw CLI arguments into typed options.
 *
 * Supports:
 *   --model <id>
 *   --session <id>
 *   --project-root <path>
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CLI arg parsing
export function parseCliArgs(args: string[]): CliOptions {
  const opts: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--model":
        if (next) {
          opts.model = next;
          i++;
        }
        break;
      case "--session":
        if (next) {
          opts.session = next;
          i++;
        }
        break;
      case "--project-root":
        if (next) {
          opts.projectRoot = next;
          i++;
        }
        break;
    }
  }

  return opts;
}

/**
 * Main entry point.
 *
 * In v1 this only parses args and prints a startup banner.
 * The actual Ink rendering loop is deferred until the React/Ink
 * dependency is wired.
 */
export async function main(args?: string[]): Promise<void> {
  const opts = parseCliArgs(args ?? []);

  // Log parsed options for now — Ink rendering is deferred.
  console.log(
    `TheoCode TUI starting (model=${opts.model ?? "default"}, session=${opts.session ?? "new"}, root=${opts.projectRoot ?? process.cwd()})`,
  );
}
