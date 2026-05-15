import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../errors.js";

/**
 * File-based hooks loader. Validates `.theokit/hooks.json` for syntactic
 * correctness when `local.settingSources` includes `"project"`. Malformed
 * config raises `ConfigurationError` loudly — never silently ignored.
 *
 * @internal
 */
export async function loadProjectHooks(
  cwd: string,
  settingSourcesIncludeProject: boolean,
): Promise<void> {
  if (!settingSourcesIncludeProject) return;
  const hooksPath = join(cwd, ".theokit", "hooks.json");
  let raw: string;
  try {
    raw = await readFile(hooksPath, "utf8");
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return;
    throw new ConfigurationError(`Failed to read hooks config: ${hooksPath}`, {
      code: "hooks_read_error",
      cause,
    });
  }
  try {
    JSON.parse(raw);
  } catch (cause) {
    throw new ConfigurationError(`Invalid JSON in hooks config: ${hooksPath}`, {
      code: "hooks_json_invalid",
      cause,
    });
  }
}
