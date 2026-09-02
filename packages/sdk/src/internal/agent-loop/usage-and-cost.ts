/**
 * Usage + cost helpers extracted from `loop.ts` (ADRs D376/D377).
 *
 * - `accumulateUsage(usage, llmOutput)` — merge a single LLM turn's 5-bucket
 *   token counts into the per-loop {@link UsageAccumulator}. Early-returns
 *   when no bucket was populated (avoids spurious zero-step entries on
 *   pure-error turns).
 * - `computeUsageCost(inputs, usage)` — resolve provider+model from the
 *   `model.id` prefix (with LlmClient.name fallback) and run the pricing
 *   registry lookup to produce the matching `CostBreakdown`. Returns
 *   `undefined` for the `auto` sentinel model.
 *
 * @internal
 */

import type { CostBreakdown, TokenUsage } from "../../types/usage.js";
import { computeCost } from "../budget/compute-cost.js";
import type { UsageAccumulator } from "../budget/usage-accumulator.js";
import { parseModelId } from "../llm/model-identifier.js";
import type { AgentLoopInputs } from "./types.js";

export interface LlmTurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export function accumulateUsage(usage: UsageAccumulator, turn: LlmTurnUsage): void {
  // D376: even errored turns may have surfaced partial usage; record them
  // when present so partial-failure runs still expose what was spent.
  const hasAnyToken =
    turn.inputTokens !== undefined ||
    turn.outputTokens !== undefined ||
    turn.cacheReadTokens !== undefined ||
    turn.cacheWriteTokens !== undefined ||
    turn.reasoningTokens !== undefined;
  if (!hasAnyToken) return;
  usage.add({
    inputTokens: turn.inputTokens,
    outputTokens: turn.outputTokens,
    cacheReadTokens: turn.cacheReadTokens,
    cacheWriteTokens: turn.cacheWriteTokens,
    reasoningTokens: turn.reasoningTokens,
  });
}

export function computeUsageCost(
  inputs: AgentLoopInputs,
  usage: TokenUsage,
): CostBreakdown | undefined {
  const modelId = inputs.model.id;
  if (modelId === undefined || modelId === "auto") return undefined;
  // Prefer the `provider/model` prefix on the model id (e.g.,
  // `anthropic/claude-opus-4-7`, `openai/gpt-4o-mini`). Fall back to the
  // LlmClient name (e.g., "openai" for OpenRouter passthrough). The pricing
  // registry's lookup chain (D376/EC-2) handles the openrouter-prefix and
  // date-suffix variants downstream.
  const parsed = parseModelId(modelId);
  const provider = parsed.provider ?? inputs.llm.name;
  const model = parsed.provider !== undefined ? parsed.name : modelId;
  return computeCost({ provider, model, usage });
}
