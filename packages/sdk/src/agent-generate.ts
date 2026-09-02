/**
 * SE9 — integrated structured output: `agent.generate(input, { output })` runs the
 * agent's NORMAL tool loop (the user's tools run first) and then coerces the final
 * answer into a Zod schema, returning a validated, inferred-typed object.
 *
 * This is SUGAR over `generateObject` (ADR D33) — it does NOT fork the
 * synthetic-forced-tool machinery. Phase 1 is the user's own `agent.send()` run;
 * phase 2 reuses `generateObjectImpl` over the run's final answer.
 *
 * @public
 */

import type { z as ZodNamespace, ZodType } from "zod";

import type { StructuredOutputErrorCode } from "./errors.js";
import { DEFAULT_AGENTIC_MODEL_ID } from "./internal/runtime/config/default-model.js";
import type { LocalOptions, ModelSelection, SDKAgent } from "./types/agent.js";
// SE9 — GenerateOptions/GenerateRunResult live in types/run.ts (co-located with
// SendOptions/RunResult they extend) so the SDKAgent interface doesn't import this
// runtime module — breaking the type cycle. Re-exported for ergonomic import.
import type { GenerateOptions, GenerateRunResult, RunResult, SDKUserMessage } from "./types/run.js";

export type { GenerateOptions, GenerateRunResult } from "./types/run.js";

/**
 * Shared implementation for `LocalAgent.generate` / `CloudAgent.generate`.
 * @internal
 */
export async function agentGenerate<T extends ZodType>(
  agent: SDKAgent,
  agentModel: string | ModelSelection | undefined,
  agentApiKey: string | undefined,
  agentLocal: LocalOptions | undefined,
  input: string | SDKUserMessage,
  options: GenerateOptions<T>,
): Promise<GenerateRunResult<ZodNamespace.infer<T>>> {
  const { output, maxRetries, errorStrategy, ...sendOptions } = options;

  // Phase 1 — the user's own tool loop.
  const run = await agent.send(input, sendOptions);
  const result = await run.wait();

  // Reuse generateObject's implementation + error taxonomy. Dynamic import keeps
  // this a runtime edge, not a static one (generate-object takes its agent factory
  // as a callback, so it never edges back here — the graph stays acyclic).
  const { generateObjectImpl, GenerateObjectError } = await import("./generate-object.js");

  // A run that did not FINISH with a text answer has nothing to structure.
  const answer = structurableAnswerOrThrow(result, GenerateObjectError);

  // Phase 2 — structure the final answer via the forced synthetic output tool.
  // The transient structuring agent is created through the public-facade DI seam
  // (`getAgentFacade()`) rather than a direct `import("./agent.js")` — the same
  // inversion `LocalAgent.fork` / eval / cron use — so this runtime-reachable
  // module never edges back to `agent.ts` (keeps the dependency graph acyclic).
  const { getAgentFacade } = await import("./internal/runtime/registry/agent-factory-registry.js");
  const facade = getAgentFacade();
  const structured = await generateObjectImpl(
    {
      prompt: answer,
      schema: output,
      // `agentModel` arrives already normalized (`this.model` passed through
      // `normalizeModel` in the LocalAgent/CloudAgent constructor), so the widened
      // `string | ModelSelection` field only ever receives a `ModelSelection` here.
      model: agentModel ?? { id: DEFAULT_AGENTIC_MODEL_ID },
      // `local` is required to keep the transient structuring agent local-only;
      // default to the process cwd when the agent had no explicit local config.
      local: agentLocal ?? { cwd: process.cwd() },
      ...(agentApiKey !== undefined ? { apiKey: agentApiKey } : {}),
      ...(maxRetries !== undefined ? { maxRetries } : {}),
      ...(errorStrategy !== undefined ? { errorStrategy } : {}),
    },
    {
      create: (opts) => facade.create(opts),
      delete: (agentId) => facade.delete(agentId),
    },
  );

  return {
    object: structured.object,
    result,
    raw: structured.raw,
    usage: structured.usage,
  };
}

/** The GenerateObjectError constructor shape (typed structurally to avoid a static import). */
type GenerateObjectErrorCtor = new (
  code: StructuredOutputErrorCode,
  message: string,
  cause?: unknown,
) => Error;

/**
 * Return the phase-1 run's final text answer, or throw a typed error when the run
 * did not FINISH with text to structure (error / cancelled / tool-only completion).
 */
function structurableAnswerOrThrow(
  result: RunResult,
  GenerateObjectError: GenerateObjectErrorCtor,
): string {
  if (result.status === "error") {
    throw new GenerateObjectError(
      "upstream_run_failed",
      `Agent run failed before an answer could be structured: ${result.error?.message ?? "unknown error"} [${result.error?.code ?? "?"}]`,
      result.error,
    );
  }
  if (result.status === "cancelled") {
    throw new GenerateObjectError(
      "run_cancelled",
      "Agent run was cancelled before an answer could be structured.",
    );
  }
  const answer = result.result;
  if (answer === undefined || answer.length === 0) {
    throw new GenerateObjectError(
      "no_text_answer",
      "The tool loop finished with no text answer (tool-only completion) — there is nothing to structure.",
    );
  }
  return answer;
}

/**
 * Test seam over `structurableAnswerOrThrow`.
 *
 * The three guards it holds map to three `RunResult` shapes, and only one of them is reachable from
 * an integration test without racing: a pre-aborted signal produces `status: "error"`, not
 * `"cancelled"` (measured 2026-09-02 — the integration test's own comment claimed the opposite for as
 * long as all three errors carried the same code and nothing could tell). Driving the function
 * directly is what lets the `cancelled` branch be covered at all.
 *
 * @internal
 */
export function _structurableAnswerOrThrowForTests(
  result: RunResult,
  ctor: GenerateObjectErrorCtor,
): string {
  return structurableAnswerOrThrow(result, ctor);
}
