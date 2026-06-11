import { escapeBlockBody } from "../escape.js";
import type { SystemPromptAssemblyContext, SystemPromptProvider } from "../types.js";

/**
 * Contributes the `<skills>` block (ADR D4 / D9).
 *
 * Input is `ReadonlyArray<{ name, description }>` — the skill body is NOT in
 * the type, so there is no path for it to leak into the system prompt.
 *
 * Both name and description are passed through `escapeBlockBody` to neutralise
 * prompt-injection vectors hidden in user-controlled SKILL.md frontmatter.
 *
 * @internal
 */
export class SkillsPromptProvider implements SystemPromptProvider {
  readonly id = "skills";
  readonly priority = 20;

  contribute(ctx: SystemPromptAssemblyContext): Promise<string | undefined> {
    if (ctx.skillsAutoInject === false) return Promise.resolve(undefined);
    if (ctx.skills.length === 0) return Promise.resolve(undefined);
    const lines = ctx.skills.map((skill) => {
      const name = escapeBlockBody(skill.name);
      const description = escapeBlockBody(skill.description);
      return `  - ${name}: ${description}`;
    });
    return Promise.resolve(`<skills>\n${lines.join("\n")}\n</skills>`);
  }
}
