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

export async function loadEvalConfig(cwd: string, configPath?: string): Promise<EvalConfig> {
  const relPath = configPath ?? "./eval.config.ts";
  const abs = isAbsolute(relPath) ? relPath : resolve(cwd, relPath);
  if (!existsSync(abs)) {
    const err = new Error(`Eval config not found: ${abs}`) as Error & { code?: string };
    err.code = "config_not_found";
    throw err;
  }

  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(abs).href)) as { default?: unknown };
  } catch (cause) {
    const err = new Error(
      `Failed to load eval config (${abs}): ${cause instanceof Error ? cause.message : String(cause)}`,
    ) as Error & { code?: string };
    err.code = "config_load_failed";
    throw err;
  }

  if (mod.default === undefined) {
    const err = new Error(
      `Eval config (${abs}) must have a default export. Example: \`export default { dataset, scorers, agent } satisfies EvalConfig;\``,
    ) as Error & { code?: string };
    err.code = "config_no_default_export";
    throw err;
  }

  // Lightweight shape check (avoid heavy Zod dep at load time — keep
  // the boot path zero-zod-import unless validation actually fails).
  const cfg = mod.default as Partial<EvalConfig>;
  if (!Array.isArray(cfg.dataset)) {
    throwShapeError(abs, "dataset", "must be an array");
  }
  if (!Array.isArray(cfg.scorers)) {
    throwShapeError(abs, "scorers", "must be an array");
  }
  if (cfg.agent === undefined || typeof cfg.agent !== "object") {
    throwShapeError(abs, "agent", "must be an Agent.create() options object");
  }
  return cfg as EvalConfig;
}

function throwShapeError(abs: string, field: string, why: string): never {
  const err = new Error(`Eval config (${abs}) is invalid: field "${field}" ${why}.`) as Error & {
    code?: string;
  };
  err.code = "config_invalid_shape";
  throw err;
}
