/**
 * `theokit eval` — minimal v1 eval runner (T5.1, ADR D199).
 *
 * EC-F MUST FIX (edge-case review 2026-05-22): validate `--output` path
 * via `safePathJoin` (D80) BEFORE writing. Without this, --output
 * `../../../etc/passwd-report.md` escapes cwd.
 *
 * @internal
 */

import { writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { PathTraversalError, safePathJoin } from "@usetheo/sdk/path-safety";
import pc from "picocolors";

import { loadEvalConfig } from "../eval/config-loader.js";
import { formatReport } from "../eval/report.js";
import { runEvalSuite } from "../eval/runner.js";

export interface EvalOptions {
  config?: string;
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

export async function runEval(opts: EvalOptions): Promise<number> {
  const cwd = process.cwd();

  // EC-F: validate --output BEFORE loading config (cheaper failure).
  let outputAbs: string;
  try {
    outputAbs = resolveOutputPath(cwd, opts.output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code ?? "unknown";
    process.stderr.write(`${pc.red("error:")} ${message}\n  ${pc.gray(`(code: ${code})`)}\n`);
    return 2;
  }

  // Load + validate config.
  let config: Awaited<ReturnType<typeof loadEvalConfig>>;
  try {
    config = await loadEvalConfig(cwd, opts.config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code ?? "unknown";
    process.stderr.write(`${pc.red("error:")} ${message}\n  ${pc.gray(`(code: ${code})`)}\n`);
    return code.startsWith("config_") ? 2 : 1;
  }

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

  // Write markdown report.
  const report = formatReport(result);
  try {
    void dirname; // path is already resolved; dirname imported for future use
    writeFileSync(outputAbs, report, "utf8");
  } catch (err) {
    process.stderr.write(
      `${pc.red("error:")} could not write report to ${outputAbs} — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  process.stdout.write(
    `\n${pc.green("✓")} ${result.aggregate.totalRows} rows · mean score ${result.aggregate.meanScore.toFixed(3)} · ` +
      `${(result.aggregate.passRatio * 100).toFixed(1)}% pass · ${result.aggregate.errorRows} error(s)\n` +
      `  report: ${outputAbs}\n`,
  );

  return 0;
}
