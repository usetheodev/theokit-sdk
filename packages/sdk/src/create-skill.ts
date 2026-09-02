/**
 * M22 — `createSkill`: define a skill in TypeScript, without a `SKILL.md` file on disk.
 *
 * An inline skill is usable ALONGSIDE filesystem skills (`AgentOptions.skills.inline`), and points
 * an agent at code-defined capabilities without a `.theokit/skills/<name>/SKILL.md`. Like file
 * skills, its `name` + `description` surface in the `<skills>` system-prompt block; its
 * `instructions` (the body) travel on the object for the consumer (the SDK injects name+description,
 * not bodies — inline and file skills are symmetric there). Inline skills override file skills on a
 * name conflict (mirrors the subagents-loader precedent).
 */

import { ConfigurationError } from "./errors.js";
import type { Skill as SkillShape } from "./internal/runtime/skills/discover-skills.js";

/** A code-defined skill (from {@link createSkill}) — a {@link Skill} plus its inline body. */
export interface InlineSkill extends SkillShape {
  /** The skill body/instructions (inline skills carry it here instead of a SKILL.md file). */
  instructions: string;
  /**
   * SE21 — supporting documents bundled with the skill (filename → content),
   * mirroring a filesystem skill's `references/` directory. Surfaced to the app
   * via `agent.skills.get(name)`; not injected into the model prompt.
   */
  references?: Record<string, string>;
}

/** Spec accepted by {@link createSkill}. */
export interface CreateSkillSpec {
  name: string;
  description: string;
  instructions: string;
  category?: string;
  dependencies?: string[];
  /** SE21 — supporting documents (filename → content), like a filesystem skill's `references/`. */
  references?: Record<string, string>;
}

/**
 * Build an {@link InlineSkill} from a code spec. Fails fast on an empty `name`/`description`
 * (error-handling.md). The synthetic `source` (`inline://<name>`) marks it as file-less.
 */
function createSkill(spec: CreateSkillSpec): InlineSkill {
  if (!spec.name) {
    throw new ConfigurationError("createSkill: `name` is required.", {
      code: "invalid_skill_spec",
    });
  }
  if (!spec.description) {
    throw new ConfigurationError("createSkill: `description` is required.", {
      code: "invalid_skill_spec",
    });
  }
  return {
    name: spec.name,
    description: spec.description,
    source: `inline://${spec.name}`,
    instructions: spec.instructions,
    ...(spec.category !== undefined ? { category: spec.category } : {}),
    ...(spec.dependencies !== undefined ? { dependencies: spec.dependencies } : {}),
    ...(spec.references !== undefined ? { references: spec.references } : {}),
  };
}

/** SE36 — `Skill.create` replaces `createSkill` (ADR 0015). @public  *
 * `Skill.create` returns an **`InlineSkill`**, not a `Skill`. The class is the namespace;
 * the inline skill descriptor is the product.
 */
export class Skill {
  private constructor() {}
  static create(spec: CreateSkillSpec): InlineSkill {
    return createSkill(spec);
  }
}
