import { diag } from "../diagnostics.js";
import type { LlmClient, LlmTool, LlmToolCallPart } from "../llm/types.js";
import { safeCall } from "../runtime/system-prompt/safe-call.js";
import { HISTOGRAM_NAMES } from "../telemetry/span-names.js";
import { stripThinkBlocks } from "../tool-dispatch/strip-think.js";
import type { LoopContext } from "./loop-context-init.js";
import type { AgentLoopInputs } from "./loop-types.js";
import { buildAssistantEvent, buildThinkingEvent } from "./message-builders.js";
import type { ResolvedTool } from "./tool-dispatch.js";

/** @internal */
export interface LlmTurnOutput {
  text: string;
  toolCalls: LlmToolCallPart[];
  stopReason: string;
  errored: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

/**
 * Concat MemoryProvider's `systemPromptAdditions` to the inbound
 * `inputs.systemPrompt`.
 * @internal
 */
export function resolveSystemPromptWithMemoryAdditions(
  systemPrompt: string | undefined,
  additions: string | undefined,
): string | undefined {
  if (additions === undefined || additions.length === 0) return systemPrompt;
  if (systemPrompt === undefined || systemPrompt.length === 0) return additions;
  return `${systemPrompt}\n\n${additions}`;
}

function toLlmTool(tool: ResolvedTool): LlmTool {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

/**
 * issue #47: extract the reasoning effort from `ModelSelection.params` — the canonical `thinking`
 * param (`{ id: "thinking", value: "high" }`) the agents bridge sets from `reasoningEffort`. Returns
 * undefined when absent so the provider request stays bare (no reasoning requested).
 * @internal
 */
export function reasoningEffortFromParams(
  params: AgentLoopInputs["model"]["params"],
): string | undefined {
  const thinking = params?.find((p) => p.id === "thinking");
  return thinking !== undefined && thinking.value.length > 0 ? thinking.value : undefined;
}

/**
 * M3 #64/#66 — emit the LLM-call duration + token throughput as metrics (were
 * span-attributes only); a provider that omits usage WARNs + counts
 * `llm_usage_missing` so budget undercount is observable instead of a silent 0.
 * @internal
 */
function emitLlmMetrics(
  inputs: AgentLoopInputs,
  result: { inputTokens?: number; outputTokens?: number },
  startAt: number,
): void {
  inputs.telemetry?.recordHistogram(HISTOGRAM_NAMES.LLM_CALL_DURATION_MS, Date.now() - startAt, {
    provider: inputs.llm.name,
  });
  if (result.inputTokens === undefined && result.outputTokens === undefined) {
    inputs.telemetry?.recordHistogram(HISTOGRAM_NAMES.LLM_USAGE_MISSING, 1, {
      provider: inputs.llm.name,
    });
    diag(
      `[theokit-sdk] llm usage missing from ${inputs.llm.name} finish — budget may undercount\n`,
    );
    return;
  }
  inputs.telemetry?.recordHistogram(
    HISTOGRAM_NAMES.LLM_TOKENS,
    (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
    { provider: inputs.llm.name },
  );
}

/** @internal */
export async function streamLlmTurn(
  inputs: AgentLoopInputs,
  ctx: LoopContext,
): Promise<LlmTurnOutput> {
  // M3 #64 — nest llm.call under the run's agent.send span (not a flat sibling).
  const llmSpan = inputs.telemetry?.startChildSpan(ctx.sendSpan, "llm.call", {
    "model.id": inputs.model.id ?? "auto",
    provider: inputs.llm.name,
  });
  const startAt = Date.now();
  const signal = inputs.signal ?? new AbortController().signal;
  const generator = inputs.llm.stream(
    {
      model: inputs.model.id ?? "auto",
      ...((): { system?: string } => {
        const effective = resolveSystemPromptWithMemoryAdditions(
          inputs.systemPrompt,
          ctx.memorySystemPromptAdditions,
        );
        return effective !== undefined ? { system: effective } : {};
      })(),
      // issue #47: forward the reasoning effort from ModelSelection.params (the `thinking` param)
      // so the provider produces reasoning. Absent param ⇒ no `reasoning` field (bare request).
      ...((): { reasoning?: { effort: string } } => {
        const effort = reasoningEffortFromParams(inputs.model.params);
        return effort !== undefined ? { reasoning: { effort } } : {};
      })(),
      // Step-cap force-close: forward the per-run tool gate (`"none"` on a ceiling round forces a
      // text close even though tools are advertised). Absent ⇒ provider default (auto).
      ...(inputs.toolChoice !== undefined ? { toolChoice: inputs.toolChoice } : {}),
      messages: ctx.messages,
      tools: ctx.tools.map(toLlmTool),
    },
    signal,
  );
  const collected = await collectLlmEvents(generator, inputs, ctx);
  if (collected.errored || collected.finishValue === undefined) {
    llmSpan?.setAttribute("stopReason", "error");
    llmSpan?.end();
    return {
      text: collected.accumulatedText,
      toolCalls: [],
      stopReason: "error",
      errored: true,
    };
  }
  const result = collected.finishValue.value as Awaited<
    ReturnType<LlmClient["stream"]>
  > extends AsyncGenerator<unknown, infer R, unknown>
    ? R
    : never;
  llmSpan?.setAttributes({
    stopReason: result.stopReason,
    inputTokens: result.inputTokens ?? 0,
    outputTokens: result.outputTokens ?? 0,
  });
  emitLlmMetrics(inputs, result, startAt);
  llmSpan?.end();
  const stripped = stripThinkBlocks(collected.accumulatedText);
  return {
    text: stripped.visible,
    toolCalls: result.toolCalls,
    stopReason: result.stopReason,
    errored: false,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheWriteTokens: result.cacheWriteTokens,
    reasoningTokens: result.reasoningTokens,
  };
}

interface CollectedEvents {
  accumulatedText: string;
  errored: boolean;
  finishValue: Awaited<ReturnType<ReturnType<LlmClient["stream"]>["next"]>> | undefined;
}

async function collectLlmEvents(
  generator: ReturnType<LlmClient["stream"]>,
  inputs: AgentLoopInputs,
  ctx: LoopContext,
): Promise<CollectedEvents> {
  let accumulatedText = "";
  let errored = false;
  let finishValue: CollectedEvents["finishValue"];
  try {
    const result = await runCollectorLoop(generator, inputs, ctx);
    accumulatedText = result.accumulatedText;
    errored = result.errored;
    finishValue = result.finishValue;
  } catch (cause) {
    if (inputs.signal?.aborted === true) {
      ctx.finalText = "[aborted]";
      ctx.events.push(buildAssistantEvent(inputs, "[aborted]"));
    } else {
      registerLoopError(ctx, cause);
      ctx.finalText = "";
    }
    errored = true;
  }
  return { accumulatedText, errored, finishValue };
}

/**
 * Set-once invariant (ADR D3, EC-3-A): first error wins.
 * @internal
 */
export function registerLoopError(ctx: LoopContext, cause: unknown): void {
  if (ctx.error !== undefined) return;
  const rawMessage = (cause as { message?: unknown } | null | undefined)?.message;
  const message =
    typeof rawMessage === "string"
      ? rawMessage
      : cause instanceof Error
        ? cause.message
        : String(cause);
  // Prefer the CANONICAL `metadata.code` (e.g. "context_too_long") over the
  // provider-PREFIXED top-level `.code` (e.g. "anthropic_context_too_long") that
  // the error mappers set for telemetry — so the run boundary (`RunResult.error.code`)
  // reports the canonical `ErrorCode` and consumer checks like
  // `result.error.code === "context_too_long"` work for every provider.
  const metaCode = (cause as { metadata?: { code?: unknown } } | null | undefined)?.metadata?.code;
  const rawCode = (cause as { code?: unknown } | null | undefined)?.code;
  const code =
    typeof metaCode === "string" ? metaCode : typeof rawCode === "string" ? rawCode : undefined;
  ctx.error = code !== undefined ? { message, code, cause } : { message, cause };
}

async function runCollectorLoop(
  generator: ReturnType<LlmClient["stream"]>,
  inputs: AgentLoopInputs,
  ctx: LoopContext,
): Promise<{
  accumulatedText: string;
  errored: boolean;
  finishValue: CollectedEvents["finishValue"];
}> {
  let accumulatedText = "";
  // issue #47/#48: reasoning streams on its own channel — `text` is accumulated for the
  // `thinking` SDKMessage replay; `startedAt` (set on the first delta) measures the duration.
  const reasoning: ReasoningAccumulator = { text: "", startedAt: undefined };
  let errored = false;
  let finishValue: CollectedEvents["finishValue"];
  // issue #48 (review Finding 1): finalize in a `finally` so a mid-stream THROW from the LLM
  // generator (e.g. a dropped connection after some reasoning deltas) still emits the one
  // `thinking-completed` — otherwise a consumer that opened a reasoning block on the first
  // `thinking-delta` would wait for a close signal that never comes. The in-band `error` event
  // path (break below) already reaches finalize; this covers the hard-throw path too.
  try {
    while (true) {
      const next = await generator.next();
      if (next.done === true) {
        finishValue = next;
        break;
      }
      if (next.value.type === "text_delta") {
        accumulatedText += next.value.text;
        await emitTextDeltaCallback(inputs, next.value.text);
      }
      if (next.value.type === "reasoning_delta") {
        await accumulateReasoning(inputs, reasoning, next.value.text);
      }
      if (next.value.type === "error") {
        registerLoopError(ctx, next.value);
        ctx.finalText = "";
        errored = true;
        break;
      }
    }
  } finally {
    await finalizeReasoning(inputs, ctx, reasoning);
  }
  return { accumulatedText, errored, finishValue };
}

/** issue #47/#48: reasoning accumulated across a single LLM turn. */
interface ReasoningAccumulator {
  text: string;
  startedAt: number | undefined;
}

/**
 * issue #47/#48: accumulate one reasoning delta — stamp the block start on the first delta
 * (for the duration measurement) and surface it live as a `thinking-delta`.
 */
async function accumulateReasoning(
  inputs: AgentLoopInputs,
  reasoning: ReasoningAccumulator,
  text: string,
): Promise<void> {
  if (reasoning.startedAt === undefined) reasoning.startedAt = Date.now();
  reasoning.text += text;
  await emitReasoningDeltaCallback(inputs, text);
}

/**
 * issue #47/#48: finalize the reasoning block for this turn. Emit the accumulated reasoning as a
 * `thinking` SDKMessage (run.stream replay) BEFORE the assistant turn — preserving reason-then-answer
 * order — carrying the measured duration, then close the live channel with a single
 * `thinking-completed` so a UI can end its reasoning block. No-op when the model produced no reasoning.
 */
async function finalizeReasoning(
  inputs: AgentLoopInputs,
  ctx: LoopContext,
  reasoning: ReasoningAccumulator,
): Promise<void> {
  if (reasoning.text.length === 0) return;
  const thinkingDurationMs =
    reasoning.startedAt === undefined ? 0 : Date.now() - reasoning.startedAt;
  ctx.events.push(buildThinkingEvent(inputs, reasoning.text, thinkingDurationMs));
  await emitThinkingCompletedCallback(inputs, thinkingDurationMs);
}

async function emitTextDeltaCallback(inputs: AgentLoopInputs, text: string): Promise<void> {
  if (inputs.onDelta === undefined) return;
  const cb = inputs.onDelta;
  await safeCall(
    () => cb({ update: { type: "text-delta", text } }),
    undefined,
    "SendOptions.onDelta",
  );
}

/** issue #47: deliver a reasoning delta live as a `thinking-delta` InteractionUpdate. */
async function emitReasoningDeltaCallback(inputs: AgentLoopInputs, text: string): Promise<void> {
  if (inputs.onDelta === undefined) return;
  const cb = inputs.onDelta;
  await safeCall(
    () => cb({ update: { type: "thinking-delta", text } }),
    undefined,
    "SendOptions.onDelta",
  );
}

/**
 * issue #48: close the reasoning channel with a single `thinking-completed` InteractionUpdate,
 * carrying the measured duration so a consumer can end its reasoning UI block.
 */
async function emitThinkingCompletedCallback(
  inputs: AgentLoopInputs,
  thinkingDurationMs: number,
): Promise<void> {
  if (inputs.onDelta === undefined) return;
  const cb = inputs.onDelta;
  await safeCall(
    () => cb({ update: { type: "thinking-completed", thinkingDurationMs } }),
    undefined,
    "SendOptions.onDelta",
  );
}
