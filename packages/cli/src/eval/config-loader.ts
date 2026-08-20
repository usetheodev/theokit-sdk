/**
 * Load + validate the user's `eval.config.{ts,mjs}` (T5.1).
 *
 * Uses a bare dynamic `import()` — no transpiler is registered here, so whether a `.ts` config loads
 * is decided by the Node that runs the CLI (its type-stripping support) or by a loader the caller
 * arranged. When it cannot, the failure arrives as `config_load_failed`, not as a syntax error.
 *
 * Validation is three hand-written checks (see {@link loadEvalConfig}); no schema library is
 * involved, despite `zod` sitting in this package's dependencies.
 *
 * @internal
 */

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { EvalConfig } from "./types.js";

function configError(code: string, message: string): Error & { code?: string } {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  return err;
}

async function importConfig(abs: string): Promise<{ default?: unknown }> {
  try {
    return (await import(pathToFileURL(abs).href)) as { default?: unknown };
  } catch (cause) {
    throw configError(
      "config_load_failed",
      `Failed to load eval config (${abs}): ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function validateShape(cfg: Partial<EvalConfig>, abs: string): EvalConfig {
  if (!Array.isArray(cfg.dataset)) throwShapeError(abs, "dataset", "must be an array");
  if (!Array.isArray(cfg.scorers)) throwShapeError(abs, "scorers", "must be an array");
  if (cfg.agent === undefined || typeof cfg.agent !== "object") {
    throwShapeError(abs, "agent", "must be an Agent.create() options object");
  }
  return cfg as EvalConfig;
}

/**
 * Import the eval config and confirm it is roughly the right shape.
 *
 * IMPORTING EXECUTES IT: top-level code in the config runs before any validation.
 *
 * The check is shallow on purpose — `dataset` is an array, `scorers` is an array, `agent` is an
 * object. Element types are NOT inspected, so a scorer that is not a function, or a dataset entry
 * with no `input`, passes here and fails later inside the run, per row.
 *
 * @throws Error with a `code`: `config_not_found`, `config_load_failed` (the module threw),
 * `config_no_default_export`, `config_invalid_shape`. `theokit eval` maps every `config_*` code to
 * exit 2.
 */
export async function loadEvalConfig(cwd: string, configPath?: string): Promise<EvalConfig> {
  const relPath = configPath ?? "./eval.config.ts";
  const abs = isAbsolute(relPath) ? relPath : resolve(cwd, relPath);
  if (!existsSync(abs)) throw configError("config_not_found", `Eval config not found: ${abs}`);

  const mod = await importConfig(abs);
  if (mod.default === undefined) {
    throw configError(
      "config_no_default_export",
      `Eval config (${abs}) must have a default export. Example: \`export default { dataset, scorers, agent } satisfies EvalConfig;\``,
    );
  }
  return validateShape(mod.default as Partial<EvalConfig>, abs);
}

function throwShapeError(abs: string, field: string, why: string): never {
  const err = new Error(`Eval config (${abs}) is invalid: field "${field}" ${why}.`) as Error & {
    code?: string;
  };
  err.code = "config_invalid_shape";
  throw err;
}
