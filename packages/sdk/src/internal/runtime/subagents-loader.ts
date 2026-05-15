import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../errors.js";
import type { AgentDefinition } from "../../types/agent.js";

/**
 * Load file-based subagents from `.theokit/agents/*.md` and merge with
 * inline definitions. Inline overrides file-based on name conflict.
 *
 * Each markdown file has YAML frontmatter (description + optional model)
 * and a body that becomes the subagent prompt.
 *
 * @internal
 */
export async function loadSubagents(
  cwd: string,
  settingSourcesIncludeProject: boolean,
  inline: Record<string, AgentDefinition> | undefined,
): Promise<Record<string, AgentDefinition>> {
  const result: Record<string, AgentDefinition> = {};
  if (settingSourcesIncludeProject) {
    const projectAgents = await readProjectSubagents(cwd);
    for (const [name, definition] of Object.entries(projectAgents)) {
      result[name] = definition;
    }
  }
  if (inline !== undefined) {
    for (const [name, definition] of Object.entries(inline)) {
      result[name] = definition;
    }
  }
  return result;
}

async function readProjectSubagents(
  cwd: string,
): Promise<Record<string, AgentDefinition>> {
  const root = join(cwd, ".theokit", "agents");
  let entries: Array<{ name: string; isFile(): boolean }>;
  try {
    entries = (await readdir(root, { withFileTypes: true })) as Array<{
      name: string;
      isFile(): boolean;
    }>;
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return {};
    throw new ConfigurationError(`Failed to read subagents directory: ${root}`, {
      code: "subagents_read_error",
      cause,
    });
  }
  const subagents: Record<string, AgentDefinition> = {};
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = join(root, entry.name);
    const raw = await readFile(path, "utf8");
    const definition = parseSubagentMarkdown(raw, entry.name);
    subagents[definition.name] = definition.definition;
  }
  return subagents;
}

function parseSubagentMarkdown(
  raw: string,
  filename: string,
): { name: string; definition: AgentDefinition } {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(raw);
  if (match === null) {
    throw new ConfigurationError(`Subagent ${filename} is missing frontmatter`, {
      code: "subagent_missing_frontmatter",
    });
  }
  const frontmatter = match[1] ?? "";
  const body = (match[2] ?? "").trim();
  const fields: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key.length > 0) fields[key] = value;
  }
  const baseName = filename.replace(/\.md$/, "");
  const name = fields.name ?? baseName;
  const description = fields.description ?? "";
  const definition: AgentDefinition = {
    description,
    prompt: body,
  };
  if (fields.model !== undefined) {
    definition.model = fields.model === "inherit" ? "inherit" : { id: fields.model };
  }
  return { name, definition };
}
