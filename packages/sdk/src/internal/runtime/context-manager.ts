import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";

import { ConfigurationError } from "../../errors.js";
import type {
  ContextBudget,
  ContextSettings,
  ContextSnapshot,
  ContextSource,
  SDKContextManager,
} from "../../types/context.js";
import { loadMarkdownEntities } from "../persistence/markdown-config-loader.js";
import { ContextSourceFrontmatterSchema } from "./context-frontmatter.js";
import { warnOnce } from "./hooks-source.js";

/**
 * File-based context manager. Reads `.theokit/context.json` from the
 * workspace cwd when `local.settingSources` includes `"project"`, loads each
 * referenced source, applies excludes, and exposes a redacted public
 * snapshot via `snapshot()`. Re-reads via `refresh()`.
 *
 * Public output is secret-free by design — raw absolute paths, .env content,
 * and excluded-file content never appear.
 *
 * @internal
 */

interface FileContextConfig {
  sources: Array<{ name: string; path: string }>;
  exclude?: string[];
  maxTokens?: number;
}

interface InternalState {
  config: FileContextConfig;
  loadedSources: Array<{
    name: string;
    path: string;
    status: ContextSource["status"];
    tokens: string[];
  }>;
}

export class FileContextManager implements SDKContextManager {
  private state: InternalState | undefined;

  constructor(
    private readonly cwd: string,
    private readonly settings: ContextSettings,
    private readonly settingSourcesIncludeProject: boolean,
  ) {}

  async initialize(): Promise<void> {
    // `context.manager: "file"` is itself an opt-in for project-level context
    // loading, even when `local.settingSources` does not include "project".
    if (!this.settingSourcesIncludeProject && this.settings.manager !== "file") {
      this.state = { config: { sources: [] }, loadedSources: [] };
      return;
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const config = await loadContextConfig(this.cwd);
    const loadedSources = await loadSources(config, this.cwd);
    this.state = { config, loadedSources };
  }

  snapshot(): Promise<ContextSnapshot> {
    const state = this.state ?? { config: { sources: [] }, loadedSources: [] };
    const sources: ContextSource[] = state.loadedSources.map((src) => ({
      name: src.name,
      path: src.path,
      status: src.status,
    }));
    const allTokens = state.loadedSources.flatMap((src) => src.tokens);
    const budget: ContextBudget = {};
    const maxTokens = this.settings.maxTokens ?? state.config.maxTokens;
    if (maxTokens !== undefined) budget.maxTokens = maxTokens;
    budget.usedTokens = allTokens;
    return Promise.resolve({ runtime: "local", sources, budget });
  }

  /**
   * Internal-only — returns per-source token slices so the system-prompt
   * `ContextPromptProvider` can format the `<source>` body. The public
   * `snapshot()` flattens tokens across sources for the budget summary,
   * which is the wrong shape for prompt assembly.
   *
   * @internal
   */
  internalAssemblySnapshot(): {
    sources: Array<{ name: string; status: ContextSource["status"]; tokens: string[] }>;
    maxTokens: number | undefined;
  } {
    const state = this.state ?? { config: { sources: [] }, loadedSources: [] };
    const maxTokens = this.settings.maxTokens ?? state.config.maxTokens;
    return {
      sources: state.loadedSources.map((src) => ({
        name: src.name,
        status: src.status,
        tokens: [...src.tokens],
      })),
      maxTokens,
    };
  }
}

/**
 * Load context config with MD-first fallback (ADR D77, T2.2).
 *
 *   1. `.theokit/context/<name>.md` (preferred).
 *   2. `.theokit/context.json` (deprecated; emits warn).
 *   3. Neither → empty sources.
 *
 * @internal
 */
async function loadContextConfig(cwd: string): Promise<FileContextConfig> {
  const mdDir = join(cwd, ".theokit", "context");
  const jsonPath = join(cwd, ".theokit", "context.json");

  const mdEntities = await loadMarkdownEntities({
    dir: mdDir,
    schema: ContextSourceFrontmatterSchema,
    pattern: "flat",
    errorCodePrefix: "context",
  });

  if (mdEntities.length > 0) {
    if (existsSync(jsonPath)) {
      warnOnce(
        "context-both-present",
        "[theokit-sdk] both .theokit/context/ and .theokit/context.json detected — using markdown; remove context.json",
      );
    }
    return {
      sources: mdEntities
        .filter((e) => e.frontmatter.enabled !== false)
        .map((e) => ({ name: e.frontmatter.name ?? e.slug, path: e.frontmatter.path })),
    };
  }

  // Fallback: JSON
  if (!existsSync(jsonPath)) return { sources: [] };

  warnOnce(
    "context-json-deprecated",
    "[theokit-sdk] .theokit/context.json is deprecated; migrate to .theokit/context/<name>.md via theokit-migrate-config",
  );

  let raw: string;
  try {
    raw = await readFile(jsonPath, "utf8");
  } catch (cause) {
    throw new ConfigurationError(`Failed to read context config: ${jsonPath}`, {
      code: "context_read_error",
      cause,
    });
  }
  return parseConfig(raw, jsonPath);
}

function parseConfig(raw: string, configPath: string): FileContextConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigurationError(`Invalid JSON in context config: ${configPath}`, {
      code: "context_json_invalid",
      cause,
    });
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ConfigurationError(`Context config must be an object: ${configPath}`, {
      code: "context_config_shape",
    });
  }
  const record = parsed as Record<string, unknown>;
  const sources = readSources(record.sources, configPath);
  const exclude = Array.isArray(record.exclude)
    ? record.exclude.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const maxTokens = typeof record.maxTokens === "number" ? record.maxTokens : undefined;
  const result: FileContextConfig = { sources };
  if (exclude !== undefined) result.exclude = exclude;
  if (maxTokens !== undefined) result.maxTokens = maxTokens;
  return result;
}

function readSources(
  sourcesRaw: unknown,
  configPath: string,
): Array<{ name: string; path: string }> {
  if (!Array.isArray(sourcesRaw)) {
    throw new ConfigurationError(`Context config sources must be an array: ${configPath}`, {
      code: "context_sources_shape",
    });
  }
  return sourcesRaw
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
    )
    .map((entry) => {
      const name = typeof entry.name === "string" ? entry.name : "";
      const path = typeof entry.path === "string" ? entry.path : "";
      return { name, path };
    })
    .filter((entry) => entry.name.length > 0 && entry.path.length > 0);
}

async function loadSources(
  config: FileContextConfig,
  cwd: string,
): Promise<InternalState["loadedSources"]> {
  const results: InternalState["loadedSources"] = [];
  for (const source of config.sources) {
    if (isExcluded(source.path, config.exclude)) {
      results.push({ ...source, status: "excluded", tokens: [] });
      continue;
    }
    const absolute = resolvePath(cwd, source.path);
    if (!absolute.startsWith(resolvePath(cwd))) {
      results.push({ ...source, status: "excluded", tokens: [] });
      continue;
    }
    try {
      await stat(absolute);
      const content = await readFile(absolute, "utf8");
      const tokens = tokenizeContent(content);
      results.push({ ...source, status: "included", tokens });
    } catch {
      results.push({ ...source, status: "excluded", tokens: [] });
    }
  }
  return results;
}

function isExcluded(path: string, excludes: string[] | undefined): boolean {
  if (excludes === undefined) return false;
  return excludes.some((pattern) => matchesGlob(pattern, path));
}

function matchesGlob(pattern: string, path: string): boolean {
  // Simple glob: "**/.env" → path ends with ".env"; "**/secrets/**" → contains "/secrets/"
  if (pattern === path) return true;
  if (pattern.startsWith("**/") && pattern.endsWith("/**")) {
    const middle = pattern.slice(3, -3);
    return path.includes(middle);
  }
  if (pattern.startsWith("**/")) {
    return path.endsWith(pattern.slice(3));
  }
  if (pattern.endsWith("/**")) {
    return path.startsWith(pattern.slice(0, -3));
  }
  return false;
}

function tokenizeContent(content: string): string[] {
  return content.split(/\s+/).filter((token) => token.length > 0);
}
