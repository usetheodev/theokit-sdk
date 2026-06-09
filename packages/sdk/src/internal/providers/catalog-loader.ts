/**
 * Dynamic provider catalog loader (T10.1, ADR D447).
 *
 * Loads provider metadata from `provider-catalog.json` at runtime.
 * Malformed entries are skipped with WARN (EC-1) — never crash.
 *
 * @internal
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerProvider } from "./registry.js";
import type { ApiMode, AuthType, ProviderProfile } from "./types.js";

const __dirname_resolved = dirname(fileURLToPath(import.meta.url));

export interface ProviderCapabilities {
  supportsToolUse: boolean;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  supportsCacheControl: boolean;
  maxContextTokens?: number;
  maxOutputTokens?: number;
}

export interface CatalogEntry {
  id: string;
  displayName: string;
  apiMode: ApiMode;
  authType: AuthType;
  baseUrl: string;
  envVars: string[];
  fallbackModels: string[];
  capabilities: ProviderCapabilities;
  aliases?: string[];
  modelsUrl?: string;
  hostname?: string;
  extraHeaders?: Record<string, string>;
}

interface LoadOptions {
  _testInjectMalformed?: boolean;
}

function validateEntry(raw: Record<string, unknown>): CatalogEntry | null {
  if (
    typeof raw.id !== "string" ||
    typeof raw.displayName !== "string" ||
    typeof raw.apiMode !== "string" ||
    typeof raw.authType !== "string" ||
    typeof raw.baseUrl !== "string" ||
    !Array.isArray(raw.envVars) ||
    !Array.isArray(raw.fallbackModels) ||
    raw.capabilities == null ||
    typeof raw.capabilities !== "object"
  ) {
    return null;
  }
  return raw as unknown as CatalogEntry;
}

export function loadProviderCatalog(opts?: LoadOptions): Record<string, CatalogEntry> {
  const catalogPath = join(__dirname_resolved, "provider-catalog.json");
  const rawText = readFileSync(catalogPath, "utf-8");
  let entries: Record<string, unknown>[] = JSON.parse(rawText);

  if (opts?._testInjectMalformed) {
    entries = [
      ...entries,
      { id: "malformed-provider", displayName: "Bad" } as Record<string, unknown>,
    ];
  }

  const result: Record<string, CatalogEntry> = {};
  for (const raw of entries) {
    const validated = validateEntry(raw as Record<string, unknown>);
    if (validated === null) {
      process.stderr.write(
        `[theokit-sdk] WARN: Skipping malformed catalog entry: ${JSON.stringify(raw).slice(0, 100)}\n`,
      );
      continue;
    }
    result[validated.id] = validated;
  }
  return result;
}

let _capabilitiesCache: Record<string, ProviderCapabilities> | null = null;

export function getCatalogCapabilities(providerId: string): ProviderCapabilities | undefined {
  if (_capabilitiesCache === null) {
    const catalog = loadProviderCatalog();
    _capabilitiesCache = {};
    for (const entry of Object.values(catalog)) {
      _capabilitiesCache[entry.id] = entry.capabilities;
    }
  }
  return _capabilitiesCache[providerId];
}

export function registerCatalogProviders(opts?: LoadOptions): void {
  const catalog = loadProviderCatalog(opts);
  for (const entry of Object.values(catalog)) {
    const profile: ProviderProfile = {
      name: entry.id,
      apiMode: entry.apiMode,
      authType: entry.authType,
      baseUrl: entry.baseUrl,
      envVars: entry.envVars,
      fallbackModels: entry.fallbackModels,
      displayName: entry.displayName,
      aliases: entry.aliases,
      modelsUrl: entry.modelsUrl,
      hostname: entry.hostname,
      extraHeaders: entry.extraHeaders,
    };
    registerProvider(profile);
  }
}
