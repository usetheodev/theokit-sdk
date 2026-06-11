/**
 * `plan_mode` — tool for toggling between normal and planning mode.
 *
 * In plan mode, the agent focuses on outlining steps rather than executing them.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, mode: string, message: string }`
 *   - `{ ok: false, error: "invalid_action" }`
 */

type Mode = "normal" | "plan";

const PLAN_INSTRUCTIONS = [
  "You are now in PLAN MODE.",
  "Outline the steps you will take before executing any code changes.",
  "Number each step. Include file paths and what will change.",
  "Do NOT make any edits or tool calls other than reading files.",
  "When ready, use plan_mode with action 'exit' to return to normal mode.",
].join("\n");

const NORMAL_INSTRUCTIONS = "Returned to NORMAL MODE. You may now execute changes.";

export interface PlanModeTool {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (input: { action: string }) => string;
  /** Expose current mode for testing. */
  currentMode: () => Mode;
}

export function createPlanModeTool(): PlanModeTool {
  let mode: Mode = "normal";

  return {
    name: "plan_mode",
    description:
      "Toggle between normal and plan mode. " +
      "Actions: 'enter' (switch to plan mode), 'exit' (return to normal), 'status' (check current mode). " +
      "Returns { ok, mode, message }.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["enter", "exit", "status"],
          description: "The action to perform.",
        },
      },
      required: ["action"],
    },
    handler: (input: { action: string }): string => {
      switch (input.action) {
        case "enter":
          mode = "plan";
          return JSON.stringify({ ok: true, mode, message: PLAN_INSTRUCTIONS });
        case "exit":
          mode = "normal";
          return JSON.stringify({ ok: true, mode, message: NORMAL_INSTRUCTIONS });
        case "status":
          return JSON.stringify({ ok: true, mode, message: `Current mode: ${mode}` });
        default:
          return JSON.stringify({
            ok: false,
            error: "invalid_action",
            message: `Unknown action '${input.action}'. Valid: enter, exit, status.`,
          });
      }
    },
    currentMode: () => mode,
  };
}
