import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../errors.js";
import { assertNoSymlinkEscape, safePathJoin } from "../security/path-guard.js";
import { parseSkillFrontmatter } from "./skill-frontmatter.js";
import { readWorkspaceDir } from "./workspace-dir.js";

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
  category?: string;
  dependencies?: string[];
}

/**
 * File-based skills loader. Discovers `.theokit/skills/<name>/SKILL.md`
 * frontmatter when `local.settingSources` includes `"project"`.
 *
 * Per ADR D10 + EC-5: malformed YAML or missing required frontmatter fields
 * exclude the skill from `list()` and emit a stderr warning. The agent run
 * continues without the broken skill.
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
      // ADRs D79-D80: defense-in-depth — even though `entry.name` comes from
      // fs.readdir (basename only, no traversal), use safePathJoin to keep
      // the invariant uniform across the codebase. assertNoSymlinkEscape
      // rejects symlinks in the skills dir that point outside (EC-1, Hermes
      // v0.2 #386 #61 symlink boundary fixes).
      let skillDir: string;
      try {
        skillDir = safePathJoin(skillsRoot, entry.name);
        assertNoSymlinkEscape(skillDir, skillsRoot);
      } catch {
        continue;
      }
      const skillPath = join(skillDir, "SKILL.md");
      let raw: string;
      try {
        raw = await readFile(skillPath, "utf8");
      } catch {
        continue;
      }
      const metadata = tryParseSkill(raw, entry.name, skillPath);
      if (metadata !== undefined) this.skills.push(metadata);
    }
  }

  list(): Promise<SkillMetadata[]> {
    // Return every discovered skill — `enabled` is a runtime hint for which
    // skills the parent agent may invoke, not a visibility filter.
    return Promise.resolve(this.skills);
  }
}

function tryParseSkill(
  raw: string,
  fallbackName: string,
  source: string,
): SkillMetadata | undefined {
  try {
    const frontmatter = parseSkillFrontmatter(raw, fallbackName);
    const metadata: SkillMetadata = {
      name: frontmatter.name,
      description: frontmatter.description,
      source,
    };
    if (frontmatter.category !== undefined) metadata.category = frontmatter.category;
    if (frontmatter.dependencies !== undefined) metadata.dependencies = frontmatter.dependencies;
    return metadata;
  } catch (cause) {
    if (cause instanceof ConfigurationError) {
      const code = cause.code ?? "unknown";
      process.stderr.write(
        `[theokit-sdk] skill ${fallbackName} skipped (${code}): ${cause.message}\n`,
      );
      return undefined;
    }
    throw cause;
  }
}
