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
    // M22 — optional custom skills directory + inline (code-defined) skills.
    private readonly skillsDir?: string,
    private readonly inline?: SkillMetadata[],
  ) {
    void _enabled;
  }

  async initialize(): Promise<void> {
    // M22 — inline skills work even without project setting sources (they need no filesystem).
    if (!this.settingSourcesIncludeProject) {
      this.skills = this.mergeInline([]);
      return;
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    // M22 — a custom skillsDir overrides the default `<cwd>/.theokit/skills` root.
    const skillsRoot = this.skillsDir ?? join(this.cwd, ".theokit", "skills");
    const discovered = await discoverSkills(skillsRoot, {
      onInvalidSkill: (info) => {
        process.stderr.write(
          `[theokit-sdk] skill ${info.name} skipped (${info.code}): ${info.message}\n`,
        );
      },
    });
    this.skills = this.mergeInline(discovered);
  }

  /** M22 — merge inline skills over discovered ones; inline wins on a name conflict. */
  private mergeInline(discovered: SkillMetadata[]): SkillMetadata[] {
    if (this.inline === undefined || this.inline.length === 0) return discovered;
    const inlineNames = new Set(this.inline.map((s) => s.name));
    return [...discovered.filter((s) => !inlineNames.has(s.name)), ...this.inline];
  }

  list(): Promise<SkillMetadata[]> {
    // Return every discovered skill — `enabled` is a runtime hint for which
    // skills the parent agent may invoke, not a visibility filter.
    return Promise.resolve(this.skills);
  }
}
