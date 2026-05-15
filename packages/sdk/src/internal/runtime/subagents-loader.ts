import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../errors.js";
import type { AgentDefinition } from "../../types/agent.js";
import { readWorkspaceDir } from "./workspace-dir.js";
import { parseSimpleYaml } from "./yaml-frontmatter.js";

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

async function readProjectSubagents(cwd: string): Promise<Record<string, AgentDefinition>> {
  const root = join(cwd, ".theokit", "agents");
  const entries = await readWorkspaceDir(root, "subagents_read_error", "subagents directory");
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
  const { frontmatter, body } = splitFrontmatter(raw, filename);
  const fields = parseFrontmatterFields(frontmatter);
  const baseName = filename.replace(/\.md$/, "");
  const name = fields.name ?? baseName;
  const definition: AgentDefinition = {
    description: fields.description ?? "",
    prompt: body,
  };
  if (fields.model !== undefined) {
    definition.model = fields.model === "inherit" ? "inherit" : { id: fields.model };
  }
  return { name, definition };
}

function splitFrontmatter(raw: string, filename: string): { frontmatter: string; body: string } {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(raw);
  if (match === null) {
    throw new ConfigurationError(`Subagent ${filename} is missing frontmatter`, {
      code: "subagent_missing_frontmatter",
    });
  }
  return { frontmatter: match[1] ?? "", body: (match[2] ?? "").trim() };
}

function parseFrontmatterFields(frontmatter: string): Record<string, string> {
  return parseSimpleYaml(frontmatter);
}
