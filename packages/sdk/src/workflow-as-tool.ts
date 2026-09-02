/**
 * SE19 — expose a {@link Workflow} as an agent tool.
 *
 * Split out of `workflow.ts` because it answers a different question: that file is about BUILDING a
 * workflow; this one is about handing a built workflow to an agent as a callable. The file-size gate
 * is what surfaced the seam, and the seam is real — nothing here runs while steps are composed.
 *
 * Re-exported from `workflow.ts`, so `@theokit/sdk/workflow` is unchanged.
 *
 * NOTE ON THE MODULE TAG: this header deliberately carries no internal-visibility tag, and does not
 * even name one — TypeScript attaches a file-leading docblock to the FIRST declaration below it, and
 * `stripInternal: true` (tsconfig.base) then deletes that declaration from the emitted `.d.ts`.
 * `tsc --noEmit` stays clean and the declaration rollup fails with `"X" is not exported by "..."`.
 * Measured twice on this file on 2026-09-01: once with the tag, and again when the comment
 * EXPLAINING the trap quoted the tag verbatim and re-armed it.
 */

import type { ZodType, z } from "zod";

import { TheokitAgentError } from "./errors.js";
import { toJsonSchema } from "./internal/zod-to-json-schema.js";
import type { CustomTool } from "./types/agent.js";
// `WorkflowRun` comes from the TYPE module, never from `workflow.ts`. Importing it from there
// created a file cycle — workflow.ts re-exports this module — which madge caught with
// tsPreCompilationDeps on, since a type-only import is still an edge. `workflowAsTool` never needed
// the `Workflow` class anyway: its parameter is structural, `{ run: (input) => Promise<...> }`.
import type { WorkflowRun } from "./types/workflow.js";

/* ─── SE19 — workflowAsTool (expose a Workflow as an agent tool) ─── */

/**
 * Raised by a {@link workflowAsTool} tool when the wrapped workflow run does not
 * reach `status: "completed"` (a step failed, the run was cancelled/suspended).
 * The dispatch converts it to a `tool_result(isError)`.
 *
 * @public
 */
export class WorkflowToolError extends TheokitAgentError {
  override readonly name = "WorkflowToolError";
  override readonly code = "workflow_tool_failed" as const;
  constructor(
    readonly toolName: string,
    readonly workflowStatus: string,
    readonly workflowError?: { name: string; message: string },
  ) {
    // Not retryable at this level: the workflow already ran and reported its own status; whether the
    // underlying failure is transient is a question for the workflow's retry policy, not the tool wrapper.
    super(
      `workflowAsTool("${toolName}"): workflow ${workflowStatus}${
        workflowError ? `: ${workflowError.message}` : ""
      }`,
      { code: "workflow_tool_failed", isRetryable: false },
    );
  }
}

/** Spec for {@link workflowAsTool}. `inputSchema` is the workflow's input shape (Zod). */
export interface WorkflowAsToolSpec<T extends ZodType> {
  /** Tool name surfaced to the LLM. Same constraints as a `CustomTool.name`. */
  name: string;
  /** Description surfaced to the LLM — when the agent should trigger the workflow. */
  description: string;
  /** Zod schema for the workflow's input (a `Workflow` carries no top-level schema). */
  inputSchema: T;
}

/**
 * SE19 — expose a {@link Workflow} as an agent {@link CustomTool}, completing the
 * "X as tools" trio (tools; agents-as-tools via `defineSubAgent`; workflows-as-tools).
 * The handler validates the model's args against `spec.inputSchema`, runs the
 * workflow, and returns its output (a string as-is, else JSON). A run that does not
 * reach `status: "completed"` raises a typed {@link WorkflowToolError} (workflow
 * step errors do NOT throw — they surface via `run.status === "failed"`).
 *
 * Accepts any `{ run }`-shaped workflow (structural), so it never imports the
 * `Workflow` class directly.
 *
 * @public
 */
export function workflowAsTool<T extends ZodType, TOutput = unknown>(
  workflow: { run: (input: z.infer<T>) => Promise<WorkflowRun<TOutput>> },
  spec: WorkflowAsToolSpec<T>,
): CustomTool {
  const inputSchema = toJsonSchema(spec.inputSchema, { unrepresentable: "any" });
  return {
    name: spec.name,
    description: spec.description,
    inputSchema,
    handler: async (rawInput: Record<string, unknown>): Promise<string> => {
      const parsed = spec.inputSchema.parse(rawInput) as z.infer<T>;
      const run = await workflow.run(parsed);
      if (run.status !== "completed") {
        throw new WorkflowToolError(spec.name, run.status, run.error);
      }
      const output = run.output;
      return typeof output === "string" ? output : JSON.stringify(output ?? null);
    },
  };
}
