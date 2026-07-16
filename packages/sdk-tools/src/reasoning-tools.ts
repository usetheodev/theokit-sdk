/**
 * SE37 — the public reasoning toolkit: `ReasoningTools.create()` returns a
 * `think` + `analyze` scratchpad (no-side-effect tools that echo the model's
 * structured reasoning back as an observation, so the ReAct loop feeds it
 * forward). Mirrors Anthropic's "think" tool + a peer's `ReasoningTools`.
 *
 * Lives in `@theokit/sdk-tools` (not core) so the full toolkit stays out of the
 * core bundle. The `reasoning: true` agent flag auto-attaches an equivalent
 * lean `think` from core; add these explicitly (`tools: [...ReasoningTools.create()]`)
 * when you want the model to reason with a scratchpad on any model.
 *
 * @public
 */

import { type CustomTool, Tool } from "@theokit/sdk";
import { z } from "zod";

/** Reasoning scratchpad tools. `ReasoningTools.create()` → `[think, analyze]`. */
export class ReasoningTools {
  private constructor() {}

  /** Build the tools. Pass `{ analyze: false }` for `think` only. */
  static create(opts?: { analyze?: boolean }): CustomTool[] {
    const think = Tool.create({
      name: "think",
      description:
        "Use this as a scratchpad to think step by step BEFORE answering or acting. Write out your " +
        "reasoning for one step. Nothing else happens — it is only your private reasoning space. " +
        "Call it as many times as you need before the final answer.",
      inputSchema: z.object({
        thought: z.string().min(1, "think: `thought` must be a non-empty string."),
      }),
      handler: ({ thought }) => thought,
    });
    if (opts?.analyze === false) return [think];

    const analyze = Tool.create({
      name: "analyze",
      description:
        "Analyze the result of a previous step or tool call. State what you looked at, your " +
        "analysis, and whether to `continue` reasoning, `validate` (double-check) your work, or " +
        "give the `final_answer`. Use this to catch your own mistakes before answering.",
      inputSchema: z.object({
        title: z.string().optional(),
        result: z.string().min(1, "analyze: `result` must describe what you are analyzing."),
        analysis: z.string().min(1, "analyze: `analysis` must contain your reasoning."),
        next_action: z.enum(["continue", "validate", "final_answer"]),
      }),
      handler: ({ title, result, analysis, next_action }) =>
        `${title ? `# ${title}\n` : ""}Result: ${result}\nAnalysis: ${analysis}\nNext: ${next_action}`,
    });
    return [think, analyze];
  }
}
