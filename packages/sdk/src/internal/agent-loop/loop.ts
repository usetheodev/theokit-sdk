import { generateRequestId } from "../ids.js";
import type { LlmContentPart, LlmToolCallPart } from "../llm/types.js";
import { IterationBudget } from "../runtime/budget/budget.js";
import { safeCall } from "../runtime/system-prompt/safe-call.js";
import { validateResponse } from "../runtime/validation/validate-response.js";
import { evaluateBudgetGate } from "./budget-gate.js";
import { initLoopContext, type LoopContext } from "./loop-context-init.js";
import { type LlmTurnOutput, streamLlmTurn } from "./loop-llm-stream.js";
import type { AgentLoopInputs, AgentLoopOutput } from "./loop-types.js";
import { buildAssistantEvent, buildAssistantTurn } from "./message-builders.js";
import { dispatchTools } from "./tool-dispatch.js";
import { accumulateUsage, computeUsageCost } from "./usage-and-cost.js";

/**
 * The real agent loop. Given an LLM client, MCP clients, hooks, and a shell
 * runner, it drives the LLM-tool-LLM cycle until the model stops. All
 * intermediate states surface as `SDKMessage` events so the caller can
 * stream them through `Run.stream()`.
 *
 * @internal
 */

export type { AgentLoopInputs, AgentLoopOutput } from "./loop-types.js";

/** T2.1 (ADR D93) — maximum number of bailout-nudge user messages to inject. */
const MAX_NUDGE_ATTEMPTS = 2;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: agent loop is the orchestrator — context build, LLM round trip, tool dispatch, stop condition, span lifecycle are deliberately co-located so the streaming contract stays linear.
export async function runAgentLoop(inputs: AgentLoopInputs): Promise<AgentLoopOutput> {
  const sendSpan = inputs.telemetry?.startSpan("agent.send", {
    agentId: inputs.agentId,
    runId: inputs.runId,
    "model.id": inputs.model.id ?? "auto",
  });
  if (sendSpan !== undefined && inputs.telemetry?.includeContent === true) {
    sendSpan.addEvent("prompt", { content: inputs.userMessage });
  }
  let ctxRef: LoopContext | undefined;
  try {
    const ctx = await initLoopContext(inputs);
    ctxRef = ctx;
    const budget =
      inputs.budget ?? new IterationBudget({ maxIterations: inputs.maxIterations ?? 8 });
    while (budget.shouldContinue()) {
      if (inputs.budgetTracker !== undefined) {
        // Fail-CLOSED gate: a tracker that throws denies the iteration
        // instead of silently proceeding past budget (arch-review L1).
        const decision = evaluateBudgetGate(inputs.budgetTracker);
        if (decision.allowed === false) {
          ctx.finalStatus = "error";
          if (decision.detail !== undefined) {
            ctx.error = { message: decision.detail, code: decision.reason ?? "budget" };
          }
          break;
        }
      }
      const usingGrace = budget.remaining <= 0 && !budget.graceCallUsed;
      if (usingGrace) budget.useGraceCall();
      const decision = await runIteration(inputs, ctx);
      if (decision === "done") break;
      if (decision === "error") {
        ctx.finalStatus = "error";
        break;
      }
      budget.consume();
    }
    if (
      budget.shouldContinue() === false &&
      ctx.finalStatus === "finished" &&
      ctx.finalText === ""
    ) {
      ctx.finalStatus = "error";
    }
    sendSpan?.setAttribute("status", ctx.finalStatus);
    if (inputs.telemetry?.includeContent === true && ctx.finalText.length > 0) {
      sendSpan?.addEvent("response", { content: ctx.finalText });
    }
    const usage = ctx.usage.hasAny() ? ctx.usage.toTokenUsage() : undefined;
    const cost = usage !== undefined ? computeUsageCost(inputs, usage) : undefined;
    if (usage !== undefined) {
      sendSpan?.setAttributes({
        totalInputTokens: usage.inputTokens,
        totalOutputTokens: usage.outputTokens,
        ...(cost?.amountUsd !== undefined ? { totalCostUsd: cost.amountUsd } : {}),
      });
    }
    if (
      ctx.finalStatus === "finished" &&
      ctx.memoryProviderHandle !== undefined &&
      inputs.memoryProvider?.sync !== undefined
    ) {
      try {
        await inputs.memoryProvider.sync(ctx.memoryProviderHandle);
      } catch {
        // Swallow — sync() MUST be non-throwing on the hot path.
      }
    }
    return {
      events: ctx.events,
      finalStatus: ctx.finalStatus,
      result: ctx.finalText,
      conversation: ctx.conversation,
      ...(usage !== undefined ? { usage } : {}),
      ...(cost !== undefined ? { cost } : {}),
      ...(ctx.error !== undefined ? { error: ctx.error } : {}),
    };
  } finally {
    if (
      ctxRef !== undefined &&
      ctxRef.memoryProviderHandle !== undefined &&
      inputs.memoryProvider !== undefined
    ) {
      try {
        await inputs.memoryProvider.dispose(ctxRef.memoryProviderHandle);
      } catch {
        // Per contract: dispose MUST be non-throwing on the hot path.
      }
    }
    sendSpan?.end();
  }
}

async function emitAssistantTextStep(
  inputs: AgentLoopInputs,
  ctx: LoopContext,
  text: string,
): Promise<void> {
  ctx.events.push(buildAssistantEvent(inputs, text));
  ctx.conversation.push({
    type: "agentConversationTurn",
    turn: { steps: [{ type: "assistantMessage", message: { text } }] },
  });
  ctx.finalText = text;
  if (inputs.onStep === undefined) return;
  const cb = inputs.onStep;
  await safeCall(
    () => cb({ step: { type: "assistantMessage", message: { text } } }),
    undefined,
    "SendOptions.onStep",
  );
}

function pushToolConversationSteps(
  ctx: LoopContext,
  calls: LlmToolCallPart[],
  results: LlmContentPart[],
): void {
  const steps: import("../../types/conversation.js").ConversationStep[] = [];
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    if (call === undefined) continue;
    steps.push({
      type: "toolCall",
      message: { callId: call.id, name: call.name, args: call.input },
    });
    const result = results[i];
    if (result?.type === "tool_result") {
      steps.push({
        type: "toolResult",
        message: {
          callId: result.toolUseId ?? call.id,
          name: call.name,
          result:
            typeof result.content === "string" ? result.content : JSON.stringify(result.content),
          isError: result.isError === true,
        },
      });
    }
  }
  if (steps.length > 0) {
    ctx.conversation.push({ type: "agentConversationTurn", turn: { steps } });
  }
}

function handleToolErrorContinuation(
  inputs: AgentLoopInputs,
  ctx: LoopContext,
  toolResults: LlmContentPart[],
): "continue" | "error" {
  const hasError = toolResults.some((part) => part.type === "tool_result" && part.isError === true);
  if (hasError) {
    ctx._consecutiveToolErrors = (ctx._consecutiveToolErrors ?? 0) + 1;
    const cap = (inputs as { maxConsecutiveToolErrors?: number }).maxConsecutiveToolErrors ?? 3;
    if (ctx._consecutiveToolErrors >= cap) return "error";
    return "continue";
  }
  ctx._consecutiveToolErrors = 0;
  return "continue";
}

function shouldNudgeAndContinue(ctx: LoopContext, llmOutput: LlmTurnOutput): boolean {
  if (ctx.nudgeAttempts >= MAX_NUDGE_ATTEMPTS) return false;
  const validation = validateResponse({
    content: llmOutput.text,
    toolCalls: llmOutput.toolCalls,
  });
  if (validation.ok) return false;
  ctx.nudgeAttempts += 1;
  ctx.messages.push({
    role: "user",
    content: [
      {
        type: "text",
        text: "Please continue your previous answer or provide a final answer.",
      },
    ],
  });
  return true;
}

async function runIteration(
  inputs: AgentLoopInputs,
  ctx: LoopContext,
): Promise<"continue" | "done" | "error"> {
  const llmOutput = await streamLlmTurn(inputs, ctx);
  accumulateUsage(ctx.usage, llmOutput);
  if (inputs.budgetTracker !== undefined) {
    const modelId = inputs.model.id ?? "auto";
    const inputT = llmOutput.inputTokens ?? 0;
    const outputT = llmOutput.outputTokens ?? 0;
    try {
      if (inputT > 0) {
        inputs.budgetTracker.track({
          tokens: inputT,
          model: modelId,
          type: "input",
        });
      }
      if (outputT > 0) {
        inputs.budgetTracker.track({
          tokens: outputT,
          model: modelId,
          type: "output",
        });
      }
    } catch {
      // Tracker.track() is contracted as non-throwing — swallow.
    }
  }
  return continueOrTerminate(inputs, ctx, llmOutput);
}

async function continueOrTerminate(
  inputs: AgentLoopInputs,
  ctx: LoopContext,
  llmOutput: LlmTurnOutput,
): Promise<"continue" | "done" | "error"> {
  if (llmOutput.errored) return "error";
  if (llmOutput.text.length > 0) {
    await emitAssistantTextStep(inputs, ctx, llmOutput.text);
  }
  if (llmOutput.stopReason !== "tool_use" || llmOutput.toolCalls.length === 0) {
    if (shouldNudgeAndContinue(ctx, llmOutput)) return "continue";
    ctx.finalStatus = "finished";
    return "done";
  }
  ctx.messages.push(buildAssistantTurn(llmOutput.text, llmOutput.toolCalls));
  const toolResults = await dispatchTools(inputs, ctx.tools, llmOutput.toolCalls, ctx.events);
  ctx.messages.push({ role: "user", content: toolResults });
  if (inputs.onStep !== undefined) {
    const cb = inputs.onStep;
    for (const call of llmOutput.toolCalls) {
      await safeCall(
        () =>
          cb({
            step: {
              type: "toolCall",
              message: { callId: call.id, name: call.name, args: call.input },
            },
          }),
        undefined,
        "SendOptions.onStep",
      );
    }
  }
  pushToolConversationSteps(ctx, llmOutput.toolCalls, toolResults);
  return handleToolErrorContinuation(inputs, ctx, toolResults);
}

/** Re-export safeListTools for backward compatibility. @internal */
export { safeListTools } from "./loop-context-init.js";

/** Generate a request id for telemetry. @internal */
export function buildRequestId(): string {
  return generateRequestId();
}
