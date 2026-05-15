import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../errors.js";

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

  async refresh(): Promise<void> {
    this.plugins = [];
    const pluginsRoot = join(this.cwd, ".theokit", "plugins");
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = (await readdir(pluginsRoot, { withFileTypes: true })) as Array<{
        name: string;
        isDirectory(): boolean;
      }>;
    } catch (cause) {
      const err = cause as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return;
      throw new ConfigurationError(`Failed to read plugins directory: ${pluginsRoot}`, {
        code: "plugins_read_error",
        cause,
      });
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(pluginsRoot, entry.name, "plugin.json");
      const metadata = await loadPluginManifest(manifestPath, entry.name);
      if (this.enabled === undefined || this.enabled.includes(metadata.name)) {
        await this.assertEntryFileExists(manifestPath, metadata, entry.name);
        this.plugins.push(metadata);
      }
    }
  }

  list(): Promise<PluginMetadata[]> {
    return Promise.resolve(this.plugins);
  }

  private async assertEntryFileExists(
    manifestPath: string,
    metadata: PluginMetadata,
    folderName: string,
  ): Promise<void> {
    const manifestRaw = await readFile(manifestPath, "utf8").catch<string>(() => "{}");
    const parsed = JSON.parse(manifestRaw) as { entry?: string };
    if (typeof parsed.entry !== "string") return;
    const entryPath = join(this.cwd, ".theokit", "plugins", folderName, parsed.entry);
    try {
      await readFile(entryPath, "utf8");
    } catch (cause) {
      throw new ConfigurationError(
        `Plugin ${metadata.name} entry file is missing: ${parsed.entry}`,
        { code: "plugin_entry_missing", cause },
      );
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

async function loadPluginManifest(
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
  return { name, version, capabilities, source };
}
