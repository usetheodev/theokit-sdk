/**
 * Top-level CLI dispatcher via commander (ADR D194).
 *
 * Subcommands: `init`, `dev`, `inspect`, `eval`.
 *
 * Exit codes:
 *  - 0  → success
 *  - 1  → unknown error
 *  - 2  → user error (bad flags, unknown subcommand suggestion)
 *
 * @internal
 */

import { Command } from "commander";

import { type DevOptions, runDev } from "./commands/dev.js";
import { type EvalOptions, runEval } from "./commands/eval.js";
import { type InitOptions, runInit } from "./commands/init.js";
import { type InspectOptions, runInspect } from "./commands/inspect.js";
import { CLI_VERSION, SDK_VERSION } from "./version.js";

export async function main(argv: ReadonlyArray<string>): Promise<number> {
  const program = new Command();
  program
    .name("theokit")
    .description("Developer CLI for @usetheo/sdk — init, dev, inspect, eval.")
    .version(CLI_VERSION, "-v, --version", "Print the CLI version and exit.")
    .addHelpText(
      "after",
      `\nBundled SDK version: ${SDK_VERSION}\n` +
        `Adoption Roadmap #1. See https://github.com/usetheo/theokit-sdk for docs.\n` +
        `\nExit codes: 0=success · 1=unknown error · 2=user error.\n`,
    );

  let exitCode = 0;
  const setExit = (code: number): void => {
    exitCode = code;
  };

  program
    .command("init [project-name]")
    .description("Scaffold a new agent project from a bundled template.")
    .option("-t, --template <name>", "Template name: minimal | ollama-local | telegram-bot")
    .option("-f, --force", "Overwrite a non-empty destination directory")
    .option("--here", "Scaffold into the current directory")
    .option("-y, --yes", "Skip interactive prompts (CI mode)")
    .action(async (projectName: string | undefined, opts: InitOptions) => {
      setExit(await runInit(projectName, opts));
    });

  program
    .command("dev")
    .description("Run the agent entry point under tsx --watch (hot-reload).")
    .option("--entry <path>", "Entry file (default: src/index.ts or package.main)")
    .option("--env <path>", "Env file to load (default: .env)")
    .action(async (opts: DevOptions) => {
      setExit(await runDev(opts));
    });

  program
    .command("inspect")
    .description("List builtin providers, embedding adapters, gateways, and plugins.")
    .option("--json", "Emit machine-readable JSON instead of the human tree view")
    .option(
      "--filter <kind>",
      "Narrow output to one kind: providers | adapters | gateway | plugins",
    )
    .action(async (opts: InspectOptions) => {
      setExit(await runInspect(opts));
    });

  program
    .command("eval")
    .description("Run an eval suite against a real LLM and emit a markdown report.")
    .option("-c, --config <path>", "Eval config file (default: ./eval.config.ts)")
    .option("-o, --output <path>", "Report output path (default: ./eval-report.md)")
    .action(async (opts: EvalOptions) => {
      setExit(await runEval(opts));
    });

  // Commander throws CommanderError after `exitOverride` runs (by design)
  // to interrupt further processing. We set exitCode in the callback and
  // swallow the throw — the caller (bin shim) reads our returned code.
  let commanderHandledIt = false;
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 6 commander exit codes mapped to 3 process codes (0/1/2) is inherently a switch ladder; extracting hurts the exit-contract clarity.
  program.exitOverride((err) => {
    commanderHandledIt = true;
    const code = err.code;
    if (code === "commander.help" || code === "commander.helpDisplayed") {
      exitCode = 0;
    } else if (code === "commander.version") {
      exitCode = 0;
    } else if (code === "commander.unknownCommand" || code === "commander.unknownOption") {
      exitCode = 2;
    } else {
      // Other commander codes (missingArgument, etc.) → user error.
      exitCode = err.exitCode > 0 ? err.exitCode : 2;
    }
  });

  try {
    await program.parseAsync(argv as string[]);
  } catch (err) {
    if (commanderHandledIt) {
      // exitCode already set by exitOverride callback.
      return exitCode;
    }
    process.stderr.write(`theokit: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  return exitCode;
}
