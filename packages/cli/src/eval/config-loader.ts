/**
 * Load + validate the user's `eval.config.{ts,mjs}` (T5.1).
 *
 * Uses dynamic `import()` so tsx handles `.ts` transpilation. Zod
 * validates the exported shape.
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
