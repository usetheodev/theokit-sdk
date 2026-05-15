import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../errors.js";

/**
 * Skill metadata exposed via `agent.skills.list()`. Full skill prompt bodies
 * are NEVER returned — only frontmatter fields.
 *
 * @internal
 */
export interface SkillMetadata {
  name: string;
  description: string;
  source: string;
}

/**
 * File-based skills loader. Discovers `.theokit/skills/<name>/SKILL.md`
 * frontmatter when `local.settingSources` includes `"project"`.
 *
 * @internal
 */
export class SkillsManager {
  private skills: SkillMetadata[] = [];

  constructor(
    private readonly cwd: string,
    private readonly enabled: string[] | undefined,
    private readonly settingSourcesIncludeProject: boolean,
  ) {}

  async initialize(): Promise<void> {
    if (!this.settingSourcesIncludeProject) {
      this.skills = [];
      return;
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.skills = [];
    const skillsRoot = join(this.cwd, ".theokit", "skills");
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = (await readdir(skillsRoot, { withFileTypes: true })) as Array<{
        name: string;
        isDirectory(): boolean;
      }>;
    } catch (cause) {
      const err = cause as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return;
      throw new ConfigurationError(`Failed to read skills directory: ${skillsRoot}`, {
        code: "skills_read_error",
        cause,
      });
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(skillsRoot, entry.name, "SKILL.md");
      let raw: string;
      try {
        raw = await readFile(skillPath, "utf8");
      } catch {
        continue;
      }
      const metadata = parseSkillFrontmatter(raw, entry.name, skillPath);
      this.skills.push(metadata);
    }
  }

  list(): Promise<SkillMetadata[]> {
    const filtered =
      this.enabled === undefined
        ? this.skills
        : this.skills.filter((skill) => this.enabled?.includes(skill.name));
    return Promise.resolve(filtered);
  }
}

function parseSkillFrontmatter(
  raw: string,
  fallbackName: string,
  source: string,
): SkillMetadata {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(raw);
  if (match === null) {
    throw new ConfigurationError(`Skill ${fallbackName} is missing frontmatter`, {
      code: "skill_missing_frontmatter",
    });
  }
  const frontmatter = match[1] ?? "";
  const fields = parseYamlSimple(frontmatter);
  const name = fields.name ?? fallbackName;
  const description = fields.description;
  if (description === undefined || description.length === 0) {
    throw new ConfigurationError(`Skill ${name} is missing required field: description`, {
      code: "skill_missing_description",
    });
  }
  return { name, description, source };
}

function parseYamlSimple(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key.length > 0) fields[key] = value;
  }
  return fields;
}
