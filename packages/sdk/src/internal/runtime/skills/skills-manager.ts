import { join } from "node:path";

import { discoverSkills, type Skill } from "./discover-skills.js";

/**
 * Skill metadata exposed via `agent.skills.list()`. Full skill prompt bodies
 * are NEVER returned — only frontmatter fields.
 *
 * @internal
 */
export type SkillMetadata = Skill;

/**
 * File-based skills loader. Discovers `.theokit/skills/<name>/SKILL.md`
 * frontmatter when `local.settingSources` includes `"project"`.
 *
 * Delegates the discovery loop to the shared `discoverSkills` primitive (M4-1,
 * single source of truth, also public via `@theokit/sdk/skills`). Per the
 * strict-frontmatter ADR + EC-5, a malformed skill is excluded from `list()`
 * and emits a stderr warning; the agent run continues without it.
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
    const skillsRoot = join(this.cwd, ".theokit", "skills");
    this.skills = await discoverSkills(skillsRoot, {
      onInvalidSkill: (info) => {
        process.stderr.write(
          `[theokit-sdk] skill ${info.name} skipped (${info.code}): ${info.message}\n`,
        );
      },
    });
  }

  list(): Promise<SkillMetadata[]> {
    // Return every discovered skill — `enabled` is a runtime hint for which
    // skills the parent agent may invoke, not a visibility filter.
    return Promise.resolve(this.skills);
  }
}
