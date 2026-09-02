import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the telemetry adapter folder. */
export const ADAPTERS_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "internal",
  "telemetry",
  "adapters",
);

/** Every adapter module, so a gate cannot silently scan a subset. */
export function listAdapterFiles(): string[] {
  return readdirSync(ADAPTERS_ROOT).filter((f) => f.endsWith(".ts"));
}
