/**
 * Top-level CLI dispatcher via commander (ADR D194).
 *
 * Subcommands: `init`, `dev`, `inspect`, `eval`, `acp`, `setup`, `db`, `tasks`.
 *
 * Exit codes at this layer:
 *  - 0  → success, and also `--help` / `--version`
 *  - 1  → unknown error (an exception that escaped a subcommand)
 *  - 2  → user error (unknown subcommand, unknown option, bad flag value)
 *
 * Subcommands are free to return codes of their own beyond these — `theokit tasks` uses 3 and 4,
 * `theokit db check-schema-drift` uses 1 to mean "drift found", and `theokit dev` forwards the
 * child process's exit code verbatim. Each command module documents its own.
 *
 * @internal
 */

import { Command } from "commander";

import { type AcpOptions, runAcp } from "./commands/acp.js";
import {
  runDbCheckSchemaDrift,
  runDbExportSchema,
  runDbGenerate,
  runDbMigrate,
  runDbPush,
  runDbStudio,
} from "./commands/db.js";
import { type DevOptions, runDev } from "./commands/dev.js";
import { type EvalOptions, runEval } from "./commands/eval.js";
import { type InitOptions, runInit } from "./commands/init.js";
import { type InspectOptions, runInspect } from "./commands/inspect.js";
import { runSetup, type SetupOptions } from "./commands/setup.js";
import {
  runTasksCancel,
  runTasksInspect,
  runTasksList,
  type TasksCancelOptions,
  type TasksInspectOptions,
  type TasksListOptions,
} from "./commands/tasks.js";
import { TEMPLATES } from "./init/templates.js";
import { CLI_VERSION, SDK_VERSION } from "./version.js";

function registerSubcommands(program: Command, setExit: (n: number) => void): void {
  program
    .command("init [project-name]")
    .description("Scaffold a new agent project from a bundled template.")
    .option(
      "-t, --template <name>",
      // Derived from the registry, not restated. This line named three templates while the
      // registry held seven — a help text that lists options is a second copy of the list, and
      // the copy is the one that goes stale.
      `Template name: ${TEMPLATES.map((t) => t.name).join(" | ")}`,
    )
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

  program
    .command("acp")
    .description(
      "Launch a stdio Agent Client Protocol (ACP) server pointing at the entry file's default-exported agent. Used by ACP-compatible hosts. ADRs D349-D360.",
    )
    .option("--entry <path>", "Entry file (default: src/index.ts or package.main)")
    .option("--permission <mode>", "Tool permission mode: ask | auto | deny (default: ask)")
    .option("--trusted-tools <list>", "Comma-separated tool names that bypass ask")
    .option("--permission-timeout-ms <ms>", "Permission request timeout in ms (default: 60000)")
    .action(async (opts: AcpOptions) => {
      setExit(await runAcp(opts));
    });

  program
    .command("setup <domain>")
    .description(
      "Stage credentials + connectivity probe for a third-party integration. Domains: gworkspace (Google Workspace).",
    )
    .option(
      "--writable <products>",
      "Comma-separated products to grant write access (e.g., 'drive,calendar')",
    )
    .option("--probe", "Run upstream connectivity check after staging credentials")
    .option(
      "--credentials-path <path>",
      "Override path to credentials.json (default: ~/.google-mcp/credentials.json)",
    )
    .option("--non-interactive", "Refuse interactive prompts; suitable for CI")
    .action(async (domain: string, opts: SetupOptions) => {
      setExit(await runSetup(domain, opts));
    });

  const db = program
    .command("db")
    .description(
      "Database tooling — wraps drizzle-kit (generate/migrate/studio/push) and emits polyglot JSON Schema 7 (export-schema/check-schema-drift). Consumes orm.config.ts that default-exports { schema }.",
    );

  db.command("generate")
    .description("drizzle-kit generate — generate SQL migrations from your schema diff")
    .action(() => {
      setExit(runDbGenerate());
    });
  db.command("migrate")
    .description("drizzle-kit migrate — apply pending migrations to the database")
    .action(() => {
      setExit(runDbMigrate());
    });
  db.command("studio")
    .description("drizzle-kit studio — launch the embedded data browser UI")
    .action(() => {
      setExit(runDbStudio());
    });
  db.command("push")
    .description("drizzle-kit push — direct schema sync (dangerous in prod; prototypes only)")
    .action(() => {
      setExit(runDbPush());
    });
  db.command("export-schema")
    .description(
      "Emit JSON Schema 7 per entity to .theokit/schema/{entity}.schema.json (polyglot consumers).",
    )
    .option("-o, --out <dir>", "Output directory (default: .theokit/schema)")
    .option("-c, --config <path>", "Path to orm.config (default: orm.config.ts)")
    .action(async (opts: { out?: string; config?: string }) => {
      setExit(await runDbExportSchema(opts));
    });
  db.command("check-schema-drift")
    .description("Re-emit schemas and diff against committed copies. Exit 1 on drift.")
    .option("-o, --out <dir>", "Output directory (default: .theokit/schema)")
    .option("-c, --config <path>", "Path to orm.config (default: orm.config.ts)")
    .action(async (opts: { out?: string; config?: string }) => {
      setExit(await runDbCheckSchemaDrift(opts));
    });

  const tasks = program
    .command("tasks")
    .description("Observe SDK Task registry (list / inspect / cancel)");

  tasks
    .command("list")
    .description("List tasks in the local JsonFileTaskStore")
    .option("--state <state>", "Filter by state (queued|running|finished|error|cancelled)")
    .option("--kind <kind>", "Filter by kind (run|batch|workflow|cron|custom)")
    .option("--json", "Emit machine-readable JSON instead of the table view")
    .action(async (opts: TasksListOptions) => {
      setExit(await runTasksList(opts));
    });

  tasks
    .command("inspect <id>")
    .description("Inspect a single task by id")
    .option("--json", "Emit machine-readable JSON")
    .action(async (id: string, opts: TasksInspectOptions) => {
      setExit(await runTasksInspect(id, opts));
    });

  tasks
    .command("cancel <id>")
    .description("Cancel a task (best-effort cross-process via cancelRequested flag)")
    .option("--reason <reason>", "Cancellation reason recorded in the registry")
    .action(async (id: string, opts: TasksCancelOptions) => {
      setExit(await runTasksCancel(id, opts));
    });
}

function mapCommanderExitCode(code: string | undefined, fallback: number): number {
  if (code === "commander.help" || code === "commander.helpDisplayed") return 0;
  if (code === "commander.version") return 0;
  if (code === "commander.unknownCommand" || code === "commander.unknownOption") return 2;
  return fallback > 0 ? fallback : 2;
}

/**
 * Parse `argv` and run the matching subcommand, returning the process exit code instead of exiting.
 *
 * `argv` is commander-shaped, i.e. the full `process.argv`: `[execPath, scriptPath, ...args]`. The
 * first two entries are skipped, so passing `["theokit", "init"]` silently drops `init` — pass
 * `["node", "theokit", "init"]` when synthesising one.
 *
 * Never throws and never calls `process.exit`; the caller decides what to do with the code (the
 * bundled `bin/theokit.ts` shim exits with it). Writes to `process.stdout` and `process.stderr`
 * directly, so redirect the streams if you need to capture the output.
 *
 * Returns `0` for success and for `--help` / `--version`, `2` for a user error, `1` for anything
 * that escaped a subcommand as an exception, and otherwise whatever the subcommand returned.
 */
export async function main(argv: ReadonlyArray<string>): Promise<number> {
  const program = new Command();
  program
    .name("theokit")
    .description("Developer CLI for @theokit/sdk — init, dev, inspect, eval.")
    .version(CLI_VERSION, "-v, --version", "Print the CLI version and exit.")
    .addHelpText(
      "after",
      `\nBundled SDK version: ${SDK_VERSION}\nAdoption Roadmap #1. See https://github.com/usetheo/theokit-sdk for docs.\n\nExit codes: 0=success · 1=unknown error · 2=user error.\n`,
    );

  let exitCode = 0;
  const setExit = (code: number): void => {
    exitCode = code;
  };
  registerSubcommands(program, setExit);

  // Commander throws CommanderError after `exitOverride` runs (by design)
  // to interrupt further processing. We set exitCode in the callback and
  // swallow the throw — the caller (bin shim) reads our returned code.
  let commanderHandledIt = false;
  program.exitOverride((err) => {
    commanderHandledIt = true;
    exitCode = mapCommanderExitCode(err.code, err.exitCode);
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
