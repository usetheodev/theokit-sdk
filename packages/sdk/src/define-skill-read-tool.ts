/**
 * SE23 — `defineSkillReadTool`: an OPT-IN factory that gives the MODEL on-demand
 * access to a skill's full body + references via a `skill_read` tool.
 *
 * TheoKit discloses skills eagerly through the `<skills>` system-prompt block
 * (name + description only). This factory is the LAZY read path: the consumer
 * explicitly adds the returned {@link CustomTool} to `tools`, and when the model
 * calls it with a skill name, it gets that skill's `instructions` (+ SE21
 * `references`). The SDK NEVER auto-injects it — bring-your-own-tools stays
 * intact (sibling of `defineSubAgent` / `workflowAsTool`). See ADR 0007.
 *
 *   import { Agent, createSkill, defineSkillReadTool } from "@theokit/sdk";
 *
 *   const skills = [createSkill({ name: "release", description: "…", instructions: "…" })];
 *   const agent = await Agent.create({
 *     model: { id: "openai/gpt-4o-mini" },
 *     skills: { inline: skills },
 *     tools: [defineSkillReadTool(skills)],
 *   });
 *
 * @public
 */

import { z } from "zod";
import type { InlineSkill } from "./create-skill.js";
import { ConfigurationError } from "./errors.js";
import { toJsonSchema } from "./internal/zod-to-json-schema.js";
import type { CustomTool } from "./types/agent.js";

const SkillReadInputSchema = z.object({
  name: z.string().min(1, "skill_read: `name` is required."),
});

/**
 * Render a skill's body (+ references) into a single model-facing string.
 * `skill.name` is expected to be a short identifier-like token (no newlines /
 * Markdown headings) — the consumer controls both the names and the tool, so
 * this is a formatting assumption, not a trust boundary.
 */
function renderSkill(skill: InlineSkill): string {
  const parts = [`# Skill: ${skill.name}`, "", skill.instructions];
  const refs = skill.references;
  if (refs !== undefined && Object.keys(refs).length > 0) {
    parts.push("", "## References");
    for (const [file, content] of Object.entries(refs)) {
      parts.push("", `### ${file}`, content);
    }
  }
  return parts.join("\n");
}

/**
 * SE23 — build an OPT-IN `skill_read` {@link CustomTool} over the given inline
 * skills. When the model calls it with `{ name }`, the handler returns that
 * skill's body + references. An UNKNOWN (but well-formed) name returns a typed
 * "not found" string the model can act on — NOT a throw that kills the run.
 * Malformed input (missing `name`) fails at the trust boundary via the schema.
 *
 * The consumer controls exposure by choosing which skills to pass; the SDK
 * never auto-injects this tool.
 *
 * @public
 */
function defineSkillReadTool(skills: ReadonlyArray<InlineSkill>): CustomTool {
  // Fail fast on duplicate names (Rule 8): a shadowed skill would be silently
  // unreachable and the "not found" list would show the name twice. Names are
  // addressed by exact, case-sensitive match — the same identity the <skills>
  // block uses — so a collision is a construction-time error, not a runtime one.
  const seen = new Set<string>();
  for (const skill of skills) {
    if (seen.has(skill.name)) {
      throw new ConfigurationError(`defineSkillReadTool: duplicate skill name "${skill.name}".`, {
        code: "duplicate_skill_name",
      });
    }
    seen.add(skill.name);
  }
  return {
    name: "skill_read",
    description:
      "Read a skill's full instructions (and any bundled reference documents) by its name. " +
      "Use this to load the body of a skill listed in the <skills> block before acting on it.",
    inputSchema: toJsonSchema(SkillReadInputSchema),
    handler: (input: Record<string, unknown>): string => {
      const { name } = SkillReadInputSchema.parse(input);
      const skill = skills.find((s) => s.name === name);
      if (skill === undefined) {
        const available = skills.map((s) => s.name).join(", ");
        return `Skill "${name}" not found. Available skills: ${available.length > 0 ? available : "(none)"}.`;
      }
      return renderSkill(skill);
    },
  };
}

/** SE36 — `SkillReadTool.create` replaces `defineSkillReadTool` (ADR 0015). @public */
export class SkillReadTool {
  private constructor() {}
  static create(skills: ReadonlyArray<InlineSkill>): CustomTool {
    return defineSkillReadTool(skills);
  }
}
