import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../errors.js";
import { readWorkspaceDir } from "./workspace-dir.js";
import { parseSimpleYaml } from "./yaml-frontmatter.js";

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
    _enabled: string[] | undefined,
    private readonly settingSourcesIncludeProject: boolean,
  ) {
    void _enabled;
  }

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
    const entries = await readWorkspaceDir(skillsRoot, "skills_read_error", "skills directory");
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
    // Return every discovered skill — `enabled` is a runtime hint for which
    // skills the parent agent may invoke, not a visibility filter.
    return Promise.resolve(this.skills);
  }
}

function parseSkillFrontmatter(raw: string, fallbackName: string, source: string): SkillMetadata {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(raw);
  if (match === null) {
    throw new ConfigurationError(`Skill ${fallbackName} is missing frontmatter`, {
      code: "skill_missing_frontmatter",
    });
  }
  const frontmatter = match[1] ?? "";
  const fields = parseSimpleYaml(frontmatter);
  const name = fields.name ?? fallbackName;
  const description = fields.description;
  if (description === undefined || description.length === 0) {
    throw new ConfigurationError(`Skill ${name} is missing required field: description`, {
      code: "skill_missing_description",
    });
  }
  return { name, description, source };
}
