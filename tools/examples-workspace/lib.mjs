// Pure logic for the examples validation workspace (no HTTP, no process spawning).
// Consumed by server.mjs; tested by lib.test.mjs (node:test).

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** Provider keys the SDK auto-detects (README order: Anthropic → OpenAI → OpenRouter). */
export const PROVIDER_ENV_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function unquote(value) {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  return quoted ? value.slice(1, -1) : value;
}

/** One dotenv line → [key, value] or null when the line carries no assignment. */
function parseEnvLine(line) {
  if (line.length === 0 || line.startsWith("#")) return null;
  const eq = line.indexOf("=");
  if (eq <= 0) return null;
  const key = line
    .slice(0, eq)
    .replace(/^export\s+/, "")
    .trim();
  if (!ENV_KEY_PATTERN.test(key)) return null;
  return [key, unquote(line.slice(eq + 1).trim())];
}

/** Parse a dotenv-style file body. Values are never logged by callers — pass-through only. */
export function parseEnvFile(content) {
  const out = {};
  for (const rawLine of content.split("\n")) {
    const pair = parseEnvLine(rawLine.trim());
    if (pair !== null) out[pair[0]] = pair[1];
  }
  return out;
}

/** Merge env objects left-to-right (later wins); drops undefined values. */
export function mergeEnv(...layers) {
  const merged = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      if (value === undefined) continue;
      merged[key] = value;
    }
  }
  return merged;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC introduces ANSI sequences — removing them is the whole point of the pattern.
const ANSI_PATTERN = /\u001B\[[0-9;]*[A-Za-z]/g;

/** Strip ANSI escape sequences so the browser output pane stays clean. */
export function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, "");
}

/** Slugs come from URLs — only kebab-case directory names are accepted (no traversal). */
export function isSafeSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

/**
 * How to execute an example: the canonical entry is `run.ts`, executed with the
 * monorepo root's tsx binary (examples resolve @theokit/sdk via their own node_modules).
 */
export function resolveRunCommand({ rootDir, exampleDir, hasRunTs }) {
  if (!hasRunTs) return null;
  return {
    command: join(rootDir, "node_modules", ".bin", "tsx"),
    args: ["run.ts"],
    cwd: exampleDir,
  };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Build the listing entry for one dir; null when it is not an example (no package.json). */
async function buildExampleEntry(examplesDir, slug, byManifest) {
  const dir = join(examplesDir, slug);
  if (!(await exists(join(dir, "package.json")))) return null;

  const [hasRunTs, installed, hasEnv] = await Promise.all([
    exists(join(dir, "run.ts")),
    exists(join(dir, "node_modules")),
    exists(join(dir, ".env")),
  ]);

  const meta = byManifest.get(slug);
  return {
    slug,
    title: meta?.title ?? slug,
    description: meta?.description ?? "",
    domain: meta?.domain ?? "extra",
    inManifest: meta !== undefined,
    manifestIndex: meta?.index ?? Number.POSITIVE_INFINITY,
    runnable: hasRunTs,
    installed,
    hasEnv,
  };
}

/**
 * Discover example dirs (must contain a package.json) and enrich with manifest
 * metadata. Order: manifest order first, then extras alphabetically.
 */
export async function discoverExamples({ examplesDir, manifest }) {
  const entries = await readdir(examplesDir, { withFileTypes: true });
  const byManifest = new Map(
    (manifest?.examples ?? []).map((entry, index) => [entry.slug, { ...entry, index }]),
  );

  const candidates = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  const found = (
    await Promise.all(
      candidates.map((entry) => buildExampleEntry(examplesDir, entry.name, byManifest)),
    )
  ).filter((entry) => entry !== null);

  found.sort((a, b) => a.manifestIndex - b.manifestIndex || a.slug.localeCompare(b.slug));
  return found.map(({ manifestIndex: _drop, ...rest }) => rest);
}
