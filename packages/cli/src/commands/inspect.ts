/**
 * `theokit inspect` — discovery of bundled SDK assets + installed
 * gateway adapters + user plugins (T3.1, ADR D198 + D201).
 *
 * Consumes `Theokit.inspect.*` (D201) — the SDK's public introspection
 * API — to avoid `ERR_PACKAGE_PATH_NOT_EXPORTED` against published
 * installs (EC-E fix).
 *
 * @internal
 */

import { Theokit } from "@usetheo/sdk";
import pc from "picocolors";

import { listGatewayAdapters } from "../inspect/gateway.js";
import { listPlugins } from "../inspect/plugins.js";

export interface InspectOptions {
  json?: boolean;
  filter?: string;
}

interface InspectResult {
  providers: ReturnType<typeof Theokit.inspect.builtinProviders>;
  embeddingAdapters: ReturnType<typeof Theokit.inspect.embeddingAdapters>;
  gateways: ReturnType<typeof listGatewayAdapters>;
  plugins: ReturnType<typeof listPlugins>;
}

function collect(filter: string | undefined, cwd: string): InspectResult {
  const all = filter === undefined || filter === "all";
  const empty = { providers: [], embeddingAdapters: [], gateways: [], plugins: [] };
  const result: InspectResult = empty as InspectResult;
  if (all || filter === "providers") {
    result.providers = Theokit.inspect.builtinProviders();
  }
  if (all || filter === "adapters") {
    result.embeddingAdapters = Theokit.inspect.embeddingAdapters();
  }
  if (all || filter === "gateway") {
    result.gateways = listGatewayAdapters();
  }
  if (all || filter === "plugins") {
    result.plugins = listPlugins(cwd);
  }
  return result;
}

function formatProviders(providers: InspectResult["providers"]): string[] {
  if (providers.length === 0) return [];
  const lines = [pc.bold(pc.cyan("Builtin LLM providers"))];
  for (const p of providers) {
    const aliases =
      p.aliases !== undefined && p.aliases.length > 0 ? ` (aliases: ${p.aliases.join(", ")})` : "";
    lines.push(
      `  • ${pc.green(p.name)}${aliases} — ${p.apiMode} · auth: ${p.authType} · ${p.baseUrl}`,
    );
  }
  lines.push("");
  return lines;
}

function formatEmbeddings(adapters: InspectResult["embeddingAdapters"]): string[] {
  if (adapters.length === 0) return [];
  const lines = [pc.bold(pc.cyan("Memory embedding adapters"))];
  for (const a of adapters) {
    lines.push(`  • ${pc.green(a.id)} — ${a.transport} · default model: ${a.defaultModel}`);
  }
  lines.push("");
  return lines;
}

function formatGateways(gateways: InspectResult["gateways"]): string[] {
  if (gateways.length === 0) return [];
  const lines = [pc.bold(pc.cyan("Gateway adapters"))];
  for (const g of gateways) {
    const status = g.installed ? pc.green("installed") : pc.gray("not installed");
    lines.push(`  • ${pc.green(g.name)} (${g.packageName}) — ${status}`);
  }
  lines.push("");
  return lines;
}

function formatPlugins(r: InspectResult): string[] {
  if (r.plugins.length > 0) {
    const lines = [pc.bold(pc.cyan("User plugins"))];
    for (const pl of r.plugins) {
      const desc = pl.description !== undefined ? ` — ${pl.description}` : "";
      lines.push(`  • ${pc.green(pl.name)} [${pl.source}]${desc}`);
    }
    return lines;
  }
  if (r.providers.length > 0 || r.embeddingAdapters.length > 0) {
    return [pc.gray("(no user plugins found in ~/.theokit/plugins/ or ./.theokit/plugins/)")];
  }
  return [];
}

function formatHuman(r: InspectResult): string {
  const lines = [
    ...formatProviders(r.providers),
    ...formatEmbeddings(r.embeddingAdapters),
    ...formatGateways(r.gateways),
    ...formatPlugins(r),
  ];
  return `${lines.join("\n")}\n`;
}

export async function runInspect(opts: InspectOptions): Promise<number> {
  // Validate filter.
  const VALID_FILTERS = new Set(["all", "providers", "adapters", "gateway", "plugins"]);
  if (opts.filter !== undefined && !VALID_FILTERS.has(opts.filter)) {
    process.stderr.write(
      `${pc.red("error:")} invalid --filter "${opts.filter}". Valid: ${Array.from(VALID_FILTERS).join(", ")}\n`,
    );
    return 2;
  }

  const result = collect(opts.filter, process.cwd());
  if (opts.json === true) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(formatHuman(result));
  }
  return 0;
}
