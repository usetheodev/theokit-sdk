import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../errors.js";
import { loadMarkdownEntities } from "../persistence/markdown-config-loader.js";
import { safePathJoin } from "../security/path-guard.js";
import { warnOnce } from "./hooks-source.js";
import { type PluginFrontmatter, PluginFrontmatterSchema } from "./plugin-frontmatter.js";
import { readWorkspaceDir } from "./workspace-dir.js";

/**
 * Plugin manifest exposed via `agent.plugins.list()`. Includes provenance
 * (source path) so callers can audit where the plugin came from.
 *
 * @internal
 */
export interface PluginMetadata {
  name: string;
  version: string;
  capabilities: string[];
  source: string;
  /** Relative path to JS entry within the plugin folder. Validated against
   *  path traversal at assertEntryFileExists time (EC-1 fix). */
  entry?: string;
}

/**
 * File-based plugin loader. Discovers `.theokit/plugins/*\/plugin.json`
 * manifests when `local.settingSources` includes `"plugins"`.
 *
 * @internal
 */
export class PluginsManager {
  private plugins: PluginMetadata[] = [];

  constructor(
    private readonly cwd: string,
    private readonly enabled: string[] | undefined,
    private readonly settingSourcesIncludePlugins: boolean,
    private readonly cloud: boolean,
    private readonly localPaths: string[] | undefined,
  ) {}

  async initialize(): Promise<void> {
    this.assertCloudRules();
    if (!this.settingSourcesIncludePlugins) {
      this.plugins = [];
      return;
    }
    await this.refresh();
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: MD-first + JSON fallback + both-present detection per plugin folder — branch table is clearer inlined.
  async refresh(): Promise<void> {
    this.plugins = [];
    const pluginsRoot = join(this.cwd, ".theokit", "plugins");
    const entries = await readWorkspaceDir(pluginsRoot, "plugins_read_error", "plugins directory");
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderName = entry.name;
      // ADR D77: prefer PLUGIN.md; fall back to plugin.json with deprecation warn.
      const mdPath = join(pluginsRoot, folderName, "PLUGIN.md");
      const jsonPath = join(pluginsRoot, folderName, "plugin.json");
      const metadata = existsSync(mdPath)
        ? await loadPluginManifestFromMarkdown(pluginsRoot, folderName)
        : await loadPluginManifestFromJson(jsonPath, folderName);
      if (existsSync(mdPath) && existsSync(jsonPath)) {
        warnOnce(
          `plugin-${folderName}-both`,
          `[theokit-sdk] both ${folderName}/PLUGIN.md and ${folderName}/plugin.json detected — using markdown; remove plugin.json`,
        );
      }
      if (!existsSync(mdPath) && existsSync(jsonPath)) {
        warnOnce(
          "plugin-json-deprecated",
          "[theokit-sdk] plugin.json manifests are deprecated; migrate to PLUGIN.md via theokit-migrate-config",
        );
      }
      if (this.enabled === undefined || this.enabled.includes(metadata.name)) {
        await this.assertEntryFileExists(metadata, folderName);
        this.plugins.push(metadata);
      }
    }
  }

  list(): Promise<PluginMetadata[]> {
    return Promise.resolve(this.plugins);
  }

  private async assertEntryFileExists(metadata: PluginMetadata, folderName: string): Promise<void> {
    const entry = metadata.entry;
    if (entry === undefined) return;
    // ADRs D79-D80 (path-guard): safePathJoin resolves THEN prefix-checks,
    // catching both literal ".." and normalized escape (e.g. "subdir/../../etc").
    // Replaces the inline T3.2 markdown-config-migration guard that only handled
    // the literal cases. PathTraversalError extends ConfigurationError (code:
    // "path_traversal") so consumers catching ConfigurationError still see it.
    const pluginRoot = join(this.cwd, ".theokit", "plugins", folderName);
    const entryPath = safePathJoin(pluginRoot, entry);
    try {
      await readFile(entryPath, "utf8");
    } catch (cause) {
      throw new ConfigurationError(`Plugin ${metadata.name} entry file is missing: ${entry}`, {
        code: "plugin_entry_missing",
        cause,
      });
    }
  }

  private assertCloudRules(): void {
    if (!this.cloud) return;
    if (this.localPaths !== undefined && this.localPaths.length > 0) {
      throw new ConfigurationError(
        "Cloud agents reject local plugin paths — plugins must come from committed repo files",
        { code: "cloud_plugin_path_rejected" },
      );
    }
  }
}

async function loadPluginManifestFromJson(
  manifestPath: string,
  folderName: string,
): Promise<PluginMetadata> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (cause) {
    throw new ConfigurationError(`Plugin ${folderName} is missing plugin.json`, {
      code: "plugin_missing_manifest",
      cause,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigurationError(`Plugin ${folderName} manifest is invalid JSON`, {
      code: "plugin_manifest_invalid",
      cause,
    });
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ConfigurationError(`Plugin ${folderName} manifest must be an object`, {
      code: "plugin_manifest_shape",
    });
  }
  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : folderName;
  const version = typeof record.version === "string" ? record.version : "0.0.0";
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.filter((cap): cap is string => typeof cap === "string")
    : [];
  const source = manifestPath.slice(manifestPath.indexOf(".theokit/"));
  const metadata: PluginMetadata = { name, version, capabilities, source };
  if (typeof record.entry === "string") metadata.entry = record.entry;
  return metadata;
}

/** Load PLUGIN.md from a plugin folder via shared markdown-config-loader. */
async function loadPluginManifestFromMarkdown(
  pluginsRoot: string,
  folderName: string,
): Promise<PluginMetadata> {
  // Use nested loader at the granularity of ONE folder by passing a tmp dir
  // expectation; simpler: read the single PLUGIN.md directly.
  const mdPath = join(pluginsRoot, folderName, "PLUGIN.md");
  let raw: string;
  try {
    raw = await readFile(mdPath, "utf8");
  } catch (cause) {
    throw new ConfigurationError(`Plugin ${folderName} is missing PLUGIN.md`, {
      code: "plugin_missing_manifest",
      cause,
    });
  }
  // Reuse the loader's split via a single-entity wrapper.
  const fakeDir = join(pluginsRoot, folderName);
  const entities = await loadMarkdownEntities({
    dir: fakeDir,
    schema: PluginFrontmatterSchema,
    pattern: "flat", // read all .md in folder; PLUGIN.md is the canonical name
    errorCodePrefix: "plugin",
  });
  const entity = entities.find((e) => e.slug === "PLUGIN");
  if (entity === undefined) {
    throw new ConfigurationError(`Plugin ${folderName} PLUGIN.md not parseable`, {
      code: "plugin_missing_manifest",
    });
  }
  const fm: PluginFrontmatter = entity.frontmatter;
  const source = mdPath.slice(mdPath.indexOf(".theokit/"));
  const metadata: PluginMetadata = {
    name: fm.name ?? folderName,
    version: fm.version ?? "0.0.0",
    capabilities: fm.capabilities ?? [],
    source,
  };
  if (fm.entry !== undefined) metadata.entry = fm.entry;
  // raw used to surface parse errors for legacy compat with tests that
  // expect the file is actually read; intentionally side-effect-free.
  void raw;
  return metadata;
}
