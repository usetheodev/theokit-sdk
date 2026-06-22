import { buildSkillsBlock } from "../../skills/skills-block.js";
import type { SystemPromptAssemblyContext, SystemPromptProvider } from "../types.js";

/**
 * Contributes the `<skills>` block (ADR D4 / D9).
 *
 * Delegates rendering to the shared `buildSkillsBlock` primitive (M4-1, single
 * source of truth, also public via `@theokit/sdk/skills`). The block builder
 * escapes name + description to neutralise prompt-injection vectors; the skill
 * body is not in the input type, so it cannot leak into the system prompt.
 *
 * @internal
 */
export class SkillsPromptProvider implements SystemPromptProvider {
  readonly id = "skills";
  readonly priority = 20;

  contribute(ctx: SystemPromptAssemblyContext): Promise<string | undefined> {
    if (ctx.skillsAutoInject === false) return Promise.resolve(undefined);
    return Promise.resolve(buildSkillsBlock(ctx.skills));
  }
}
