import { REASONING_PREAMBLE } from "../native-reasoning.js";
import type { SystemPromptAssemblyContext, SystemPromptProvider } from "../types.js";

/**
 * SE37 — contributes the reasoning CoT preamble when `reasoning: true` is active
 * for the send. Priority 1 places it at the very top of the assembled prompt
 * (before context/skills/memory/base), so the model reads the "think step by
 * step" instruction first. Inert (`undefined`) when reasoning is off — so the
 * assembled prompt is byte-identical to baseline when the flag is unused.
 *
 * @internal
 */
export class ReasoningPromptProvider implements SystemPromptProvider {
  readonly id = "reasoning";
  readonly priority = 1;

  contribute(ctx: SystemPromptAssemblyContext): Promise<string | undefined> {
    return Promise.resolve(ctx.reasoning === true ? REASONING_PREAMBLE : undefined);
  }
}
