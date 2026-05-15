import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { McpServerConfig } from "../../types/mcp.js";

/**
 * Build the list of tool names exposed via the `system.init` event from the
 * configured MCP servers. Sanitizes server names with punctuation into
 * `mcp_<server>_<tool>` form so consumers never see raw config paths.
 *
 * @internal
 */
export async function buildToolList(
  cwd: string,
  inline: Record<string, McpServerConfig> | undefined,
  sendOverride: Record<string, McpServerConfig> | undefined,
  settingSourcesIncludeProject: boolean,
): Promise<string[]> {
  const tools: string[] = ["shell"];
  const effective = sendOverride ?? inline ?? {};
  for (const name of Object.keys(effective)) {
    tools.push(`mcp_${sanitizeName(name)}_call`);
  }
  if (settingSourcesIncludeProject) {
    const projectServers = await readProjectMcpConfig(cwd);
    for (const name of Object.keys(projectServers)) {
      tools.push(`mcp_${sanitizeName(name)}_call`);
    }
  }
  return tools;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function readProjectMcpConfig(cwd: string): Promise<Record<string, McpServerConfig>> {
  const path = join(cwd, ".theokit", "mcp.json");
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { servers?: Record<string, McpServerConfig> };
    return parsed.servers ?? {};
  } catch {
    return {};
  }
}
