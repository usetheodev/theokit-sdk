import type { SystemPromptAssemblyContext, SystemPromptProvider } from "../types.js";

/**
 * Wraps the user-resolved base system prompt as the final contribution in
 * the pipeline. Priority 100 = last (after Context/Skills/Memory).
 *
 * The base prompt is the agent author's own intent — it is NOT passed through
 * `escapeBlockBody`. Auto-injected blocks (context/skills/memory) escape
 * dynamic content because they may carry user-controlled data.
 *
 * @internal
 */
export class BasePromptProvider implements SystemPromptProvider {
  readonly id = "base";
  readonly priority = 100;

  contribute(ctx: SystemPromptAssemblyContext): Promise<string | undefined> {
    return Promise.resolve(ctx.baseSystemPrompt);
  }
}
