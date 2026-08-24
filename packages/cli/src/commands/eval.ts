/**
 * `theokit eval` — minimal v1 eval runner (T5.1, ADR D199).
 *
 * Reads `eval.config.ts` from cwd, runs every dataset entry against a REAL provider (each entry
 * costs one agent turn and real tokens), and writes a markdown report.
 *
 * Exit codes: `0` success; `2` for a `--output` that escapes cwd or ANY config-loading failure —
 * missing file, a throw while importing it, no default export, wrong shape (every one of those
 * carries a `config_*` code); `1` when the eval run itself fails or the report cannot be written.
 *
 * EC-F MUST FIX (edge-case review 2026-05-22): validate `--output` path
 * via `safePathJoin` (D80) BEFORE writing. Without this, --output
 * `../../../etc/passwd-report.md` escapes cwd.
 *
 * @internal
 */

import { writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { PathTraversalError, safePathJoin } from "@theokit/sdk/path-safety";
import pc from "picocolors";

import { loadEvalConfig } from "../eval/config-loader.js";
import { formatReport } from "../eval/report.js";
import { runEvalSuite } from "../eval/runner.js";

/** Flags for {@link runEval}. */
export interface EvalOptions {
  /** Config module. Default `./eval.config.ts`. Absolute paths are used as-is and are NOT confined to cwd. */
  config?: string;
  /** Report path. Default `eval-report.md`. Must resolve INSIDE cwd (EC-F) or the run exits 2. */
  output?: string;
}

function resolveOutputPath(cwd: string, output: string | undefined): string {
  const target = output ?? "eval-report.md";
  try {
    // EC-F: safePathJoin throws PathTraversalError if `target` escapes cwd.
    return safePathJoin(cwd, target);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      const e = new Error(
        `--output path must be inside the current working directory. Got: ${target}`,
      ) as Error & { code?: string };
      e.code = "invalid_output_path";
      throw e;
    }
    throw err;
  }
}

function reportError(err: unknown, prefix = "error:"): { message: string; code: string } {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string }).code ?? "unknown";
  process.stderr.write(`${pc.red(prefix)} ${message}\n  ${pc.gray(`(code: ${code})`)}\n`);
  return { message, code };
}

async function loadAndValidateConfig(
  cwd: string,
  configPath: string | undefined,
): Promise<Awaited<ReturnType<typeof loadEvalConfig>> | { failureExit: number }> {
  try {
    return await loadEvalConfig(cwd, configPath);
  } catch (err) {
    const { code } = reportError(err);
    return { failureExit: code.startsWith("config_") ? 2 : 1 };
  }
}

function writeReport(outputAbs: string, report: string): boolean {
  try {
    void dirname; // path is already resolved; dirname imported for future use
    writeFileSync(outputAbs, report, "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `${pc.red("error:")} could not write report to ${outputAbs} — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return false;
  }
}

/**
 * Run the eval suite described by the config and write the markdown report.
 *
 * The `--output` path is validated FIRST, before the config is even loaded, so a bad path fails
 * before anything is spent. The report is overwritten without warning, and an existing report is
 * left untouched when the run fails.
 *
 * Note the asymmetry between the two paths: `--output` is confined to cwd, `--config` is not — the
 * config is a module you are choosing to execute, and executing it is the point.
 *
 * @returns the process exit code (0 / 1 / 2 as described at the top of this file). A suite where
 * every row errored still exits 0 — the report is the result, the exit code only reports whether the
 * run itself completed.
 */
export async function runEval(opts: EvalOptions): Promise<number> {
  const cwd = process.cwd();

  // EC-F: validate --output BEFORE loading config (cheaper failure).
  let outputAbs: string;
  try {
    outputAbs = resolveOutputPath(cwd, opts.output);
  } catch (err) {
    reportError(err);
    return 2;
  }

  const configOrErr = await loadAndValidateConfig(cwd, opts.config);
  if ("failureExit" in configOrErr) return configOrErr.failureExit;
  const config = configOrErr;

  process.stdout.write(
    `${pc.cyan("[eval]")} running ${config.dataset.length} prompt(s) with ${config.scorers.length} scorer(s)...\n`,
  );

  let result: Awaited<ReturnType<typeof runEvalSuite>>;
  try {
    result = await runEvalSuite(config);
  } catch (err) {
    process.stderr.write(
      `${pc.red("error:")} eval run failed — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  if (!writeReport(outputAbs, formatReport(result))) return 1;

  process.stdout.write(
    `\n${pc.green("✓")} ${result.aggregate.totalRows} rows · mean score ${result.aggregate.meanScore.toFixed(3)} · ` +
      `${(result.aggregate.passRatio * 100).toFixed(1)}% pass · ${result.aggregate.errorRows} error(s)\n` +
      `  report: ${outputAbs}\n`,
  );

  return 0;
}
