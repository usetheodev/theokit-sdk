import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../../errors.js";
import { assertNoSymlinkEscape, safePathJoin } from "../../security/path-guard.js";
import { readWorkspaceDir } from "../config/workspace-dir.js";
import { parseSkillFrontmatter } from "./skill-frontmatter.js";

/**
 * A discovered skill's metadata. The skill BODY is never included — only the
 * strict frontmatter fields plus the resolved `source` path.
 *
 * Public via `@theokit/sdk/skills`.
 *
 * @public
 */
export interface Skill {
  name: string;
  description: string;
  /** Absolute path to the discovered `SKILL.md`. */
  source: string;
  category?: string;
  dependencies?: string[];
}

/**
 * Information passed to `onInvalidSkill` when a `SKILL.md` is present but its
 * frontmatter is malformed (missing required field or invalid YAML).
 *
 * @public
 */
export interface InvalidSkillInfo {
  /** The skill directory name (used as the fallback skill name). */
  name: string;
  /** Absolute path to the offending `SKILL.md`. */
  source: string;
  /** Typed reason: `missing_frontmatter` or `schema_invalid`. */
  code: string;
  message: string;
}

/**
 * Options for {@link discoverSkills}.
 *
 * @public
 */
export interface DiscoverSkillsOptions {
  /**
   * Called once per directory that contains a `SKILL.md` with malformed
   * frontmatter. The skill is excluded from the result; discovery continues
   * (strict-frontmatter ADR / EC-5). A directory WITHOUT a `SKILL.md` is NOT a
   * malformed skill and does not trigger this callback.
   *
   * Default: no-op (a library primitive must not write to the consumer's
   * stderr by default).
   */
  onInvalidSkill?: (info: InvalidSkillInfo) => void;
}

/**
 * Discover `SKILL.md` skills under an arbitrary directory.
 *
 * For each immediate subdirectory `<dir>/<name>/` containing a `SKILL.md`, the
 * file's strict YAML frontmatter is parsed (`name`/`description` required;
 * `category`/`dependencies` optional). Malformed skills are skipped (optionally
 * reported via {@link DiscoverSkillsOptions.onInvalidSkill}); a subdirectory
 * whose realpath escapes `dir` (via symlink) is skipped (symlink-escape guard,
 * reusing `@theokit/sdk/path-safety`).
 *
 * NEVER throws: a missing, unreadable, or non-directory `dir` yields `[]`.
 *
 * Discovery order follows the filesystem `readdir` order (OS-dependent). Sort
 * the result before {@link buildSkillsBlock} if a stable block order matters.
 *
 * Public via `@theokit/sdk/skills`.
 *
 * @public
 */
export async function discoverSkills(
  dir: string,
  options?: DiscoverSkillsOptions,
): Promise<Skill[]> {
  let entries: Awaited<ReturnType<typeof readWorkspaceDir>>;
  try {
    entries = await readWorkspaceDir(dir, "skills_read_error", "skills directory");
  } catch {
    // never-throw contract: unreadable / not-a-directory → no skills (EC-1)
    return [];
  }

  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let skillDir: string;
    try {
      skillDir = safePathJoin(dir, entry.name);
      assertNoSymlinkEscape(skillDir, dir);
    } catch {
      continue;
    }
    const skillPath = join(skillDir, "SKILL.md");
    let raw: string;
    try {
      raw = await readFile(skillPath, "utf8");
    } catch {
      // no SKILL.md in this subdir → not a skill, not an error (EC-2)
      continue;
    }
    const skill = tryParseSkill(raw, entry.name, skillPath, options);
    if (skill !== undefined) skills.push(skill);
  }
  return skills;
}

function tryParseSkill(
  raw: string,
  fallbackName: string,
  source: string,
  options: DiscoverSkillsOptions | undefined,
): Skill | undefined {
  try {
    const frontmatter = parseSkillFrontmatter(raw, fallbackName);
    const skill: Skill = {
      name: frontmatter.name,
      description: frontmatter.description,
      source,
    };
    if (frontmatter.category !== undefined) skill.category = frontmatter.category;
    if (frontmatter.dependencies !== undefined) skill.dependencies = frontmatter.dependencies;
    return skill;
  } catch (cause) {
    if (cause instanceof ConfigurationError) {
      options?.onInvalidSkill?.({
        name: fallbackName,
        source,
        code: cause.code ?? "unknown",
        message: cause.message,
      });
      return undefined;
    }
    throw cause;
  }
}
