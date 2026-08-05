/**
 * `update_plan` — built-in tool for coding agents.
 *
 * Codex-faithful: the model posts a DECLARATIVE plan — an ordered list of short steps, each
 * `pending | in_progress | completed` — and refreshes it as work proceeds. Codex's invariant is
 * "exactly one step in_progress until everything is done"; this tool WARNS (never rejects) when that
 * doesn't hold, so the agent self-corrects on the next update rather than failing the turn.
 *
 * Surface-agnostic by design (M17 DX): the result is STRUCTURED (`{ ok, steps, warning? }`) — each
 * surface (terminal TUI, desktop, web) renders the checklist however it likes, rather than the package
 * hard-coding glyphs. Result shape (always a JSON string):
 *   - `{ ok: true, explanation: string | null, steps: PlanStep[], warning?: string }`
 */

import type { CustomTool } from "@theokit/sdk";
import { Tool } from "@theokit/sdk";
import { z } from "zod";

const STATUS = ["pending", "in_progress", "completed"] as const;

const planStepSchema = z.object({
  step: z.string().min(1).max(100).describe("A short step, ≤ ~7 words."),
  status: z.enum(STATUS),
});

export function createUpdatePlanTool(): CustomTool {
  return Tool.create({
    name: "update_plan",
    description:
      "Post or refresh a short plan so the user sees your progress on a multi-step task. Pass an ordered " +
      "`plan` of steps, each with a status (pending | in_progress | completed); keep exactly one step " +
      "in_progress at a time and mark steps completed as you finish. Returns { ok, steps, warning? } as a " +
      "JSON string — the surface renders the checklist. A `warning` is returned (not an error) if the " +
      "one-in_progress invariant is violated, so you can self-correct on the next update.",
    inputSchema: z.object({
      explanation: z
        .string()
        .max(200)
        .optional()
        .describe("One line on what changed / why (optional)."),
      plan: z.array(planStepSchema).min(1).describe("The ordered steps."),
    }),
    handler: ({ explanation, plan }) => {
      const inProgress = plan.filter((s) => s.status === "in_progress").length;
      const allDone = plan.every((s) => s.status === "completed");
      const warning =
        !allDone && inProgress !== 1
          ? `keep exactly one step in_progress until all are completed — found ${inProgress}`
          : undefined;
      return JSON.stringify({ ok: true, explanation: explanation ?? null, steps: plan, warning });
    },
  });
}
