import type { ConversationTurn } from "../../types/conversation.js";
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKSystemMessage,
  SDKUserMessageEvent,
} from "../../types/messages.js";
import type { RunStatus } from "../../types/run.js";
import { UsageAccumulator } from "../budget/usage-accumulator.js";
import { generateRequestId } from "../ids.js";
import type {
  LlmClient,
  LlmContentPart,
  LlmMessage,
  LlmTool,
  LlmToolCallPart,
} from "../llm/types.js";
import type { McpClient, McpTool } from "../mcp/client.js";
import { IterationBudget } from "../runtime/budget.js";
import { safeCall } from "../runtime/system-prompt/safe-call.js";
import { stripThinkBlocks } from "../tool-dispatch/strip-think.js";
import type { AgentLoopErrorDetail, AgentLoopInputs, AgentLoopOutput } from "./loop-types.js";
import { dispatchTools, type ResolvedTool } from "./tool-dispatch.js";
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: agent loop is the orchestrator — context build, LLM round trip, tool dispatch, stop condition, span lifecycle are deliberately co-located so the streaming contract stays linear.
export async function runAgentLoop(inputs: AgentLoopInputs): Promise<AgentLoopOutput> {
  // Root span for the entire send (D34). No-op when telemetry disabled.
  const sendSpan = inputs.telemetry?.startSpan("agent.send", {
    agentId: inputs.agentId,
    runId: inputs.runId,
    "model.id": inputs.model.id ?? "auto",
  });
  if (sendSpan !== undefined && inputs.telemetry?.includeContent === true) {
    sendSpan.addEvent("prompt", { content: inputs.userMessage });
  }
  try {
    const ctx = await initLoopContext(inputs);
    // T4.2 (ADRs D90-D91): IterationBudget replaces the bare counter so
    // grace-call semantics, compression cap, and EC-4 NaN safety land in
    // one canonical place. Caller-supplied `budget` overrides defaults.
    const budget =
      inputs.budget ?? new IterationBudget({ maxIterations: inputs.maxIterations ?? 8 });
    while (budget.shouldContinue()) {
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
      // Budget + grace exhausted without final answer — surface as error.
      ctx.finalStatus = "error";
    }
    sendSpan?.setAttribute("status", ctx.finalStatus);
    if (inputs.telemetry?.includeContent === true && ctx.finalText.length > 0) {
      sendSpan?.addEvent("response", { content: ctx.finalText });
    }
    // D376 / D377: surface aggregated token usage + cost on the loop output
    // so RunResult.usage / RunResult.cost can be populated by the runtime.
    const usage = ctx.usage.hasAny() ? ctx.usage.toTokenUsage() : undefined;
    const cost = usage !== undefined ? computeUsageCost(inputs, usage) : undefined;
    if (usage !== undefined) {
      sendSpan?.setAttributes({
        totalInputTokens: usage.inputTokens,
        totalOutputTokens: usage.outputTokens,
        ...(cost?.amountUsd !== undefined ? { totalCostUsd: cost.amountUsd } : {}),
      });
    }
    return {
      events: ctx.events,
      finalStatus: ctx.finalStatus,
      result: ctx.finalText,
      conversation: ctx.conversation,
      ...(usage !== undefined ? { usage } : {}),
      ...(cost !== undefined ? { cost } : {}),
      // Finding-B fix: surface structured error so runtime can package
      // it as RunResult.error instead of leaking it as assistant content.
      ...(ctx.error !== undefined ? { error: ctx.error } : {}),
    };
  } finally {
    sendSpan?.end();
  }
}

interface LoopContext {
  events: SDKMessage[];
  conversation: ConversationTurn[];
  messages: LlmMessage[];
  tools: ResolvedTool[];
  finalText: string;
  finalStatus: RunStatus;
  /** D376: per-loop UsageAccumulator merging every LLM step. */
  usage: UsageAccumulator;
  /**
   * Finding-B fix: structured transport/provider error. Set-once invariant
   * (first-error-wins, ADR D3). When set, the loop returns with
   * `finalStatus: "error"` and copies this verbatim onto `AgentLoopOutput.error`.
   */
  error?: AgentLoopErrorDetail;
}

async function initLoopContext(inputs: AgentLoopInputs): Promise<LoopContext> {
  const tools = await collectTools(inputs.mcp);
  for (const memTool of inputs.memoryTools ?? []) {
    tools.push({
      name: memTool.name,
      description: memTool.description,
      inputSchema: memTool.inputSchema,
      origin: "memory",
      memoryHandler: memTool.execute,
    });
  }
  for (const customTool of inputs.customTools ?? []) {
    tools.push({
      name: customTool.name,
      description: customTool.description,
      inputSchema: customTool.inputSchema,
      origin: "custom",
      customHandler: customTool.handler,
    });
  }
  const events: SDKMessage[] = [
    buildSystemEvent(
      inputs,
      tools.map((t) => t.name),
    ),
    buildUserEvent(inputs),
  ];
  const priorMessages: LlmMessage[] = (inputs.priorMessages ?? []).map((msg) => ({
    role: msg.role,
    content: [{ type: "text", text: msg.text }],
  }));
  return {
    events,
    conversation: [],
    messages: [
      ...priorMessages,
      { role: "user", content: [{ type: "text", text: inputs.userMessage }] },
    ],
    tools,
    finalText: "",
    finalStatus: "finished",
    usage: new UsageAccumulator(),
  };
}

async function runIteration(
  inputs: AgentLoopInputs,
  ctx: LoopContext,
): Promise<"continue" | "done" | "error"> {
  const llmOutput = await streamLlmTurn(inputs, ctx);
  accumulateUsage(ctx.usage, llmOutput);
  return continueOrTerminate(inputs, ctx, llmOutput);
}

async function continueOrTerminate(
  inputs: AgentLoopInputs,
  ctx: LoopContext,
  llmOutput: LlmTurnOutput,
): Promise<"continue" | "done" | "error"> {
  if (llmOutput.errored) return "error";
  if (llmOutput.text.length > 0) {
    ctx.events.push(buildAssistantEvent(inputs, llmOutput.text));
    ctx.conversation.push({
      type: "agentConversationTurn",
      turn: { steps: [{ type: "assistantMessage", message: { text: llmOutput.text } }] },
    });
    ctx.finalText = llmOutput.text;
    if (inputs.onStep !== undefined) {
      const cb = inputs.onStep;
      await safeCall(
        () => cb({ step: { type: "assistantMessage", message: { text: llmOutput.text } } }),
        undefined,
        "SendOptions.onStep",
      );
    }
  }
  if (llmOutput.stopReason !== "tool_use" || llmOutput.toolCalls.length === 0) {
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
  if (toolResults.some((part) => part.type === "tool_result" && part.isError === true)) {
    return "error";
  }
  return "continue";
}

interface LlmTurnOutput {
  text: string;
  toolCalls: LlmToolCallPart[];
  stopReason: string;
  errored: boolean;
  /** D376: per-turn token counts (5 buckets). */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

async function streamLlmTurn(inputs: AgentLoopInputs, ctx: LoopContext): Promise<LlmTurnOutput> {
  const llmSpan = inputs.telemetry?.startSpan("llm.call", {
    "model.id": inputs.model.id ?? "auto",
    provider: inputs.llm.name,
  });
  // D318 — propagate caller's AbortSignal down to the LLM transport. The LLM
  // clients already accept `signal` via `fetch({ signal })`; the bug fixed
  // here is that production paths used a fresh, never-aborting controller.
  const signal = inputs.signal ?? new AbortController().signal;
  const generator = inputs.llm.stream(
    {
      model: inputs.model.id ?? "auto",
      ...(inputs.systemPrompt !== undefined ? { system: inputs.systemPrompt } : {}),
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
  llmSpan?.end();
  // T4.1 (ADR D96): strip `<think>` blocks BEFORE returning text. This
  // prevents DeepSeek-R1 / Qwen-QwQ chain-of-thought from polluting the
  // message history (Hermes v0.2 #174). Visible answer + tool calls only.
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
    // Finding-B fix (sdk-error-packaging-fix-plan v1.1):
    // Split the two paths the previous single-text branch collapsed.
    //   1. Abort → preserve `"[aborted]"` SDKAssistantMessage (UX seam).
    //   2. Transport / provider error → populate ctx.error so the error
    //      surfaces structured on AgentLoopOutput.error and downstream
    //      RunResult.error. NEVER emit an assistant message — that was
    //      the leak Finding B exposed.
    // EC-7 DOCUMENT: non-Error throws (e.g., `throw "boom"`) stringify
    //   via `String(cause)` — accepted (matches Node convention).
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
 * Set-once invariant (ADR D3, EC-3-A): first error wins. Once `ctx.error`
 * is populated, subsequent transport / provider errors in the same run are
 * dropped — they DO NOT overwrite the first error. EC-1 MUST FIX:
 * `cause.code` is typeof-guarded so a non-string value never lands on the
 * wire as the literal `"undefined"`.
 *
 * Accepts either a thrown `Error` (catch path) or an `LlmEvent` of shape
 * `{ type: "error", message, code? }` (in-stream error event) — both
 * carry `.message` so we extract it before falling back to `String(...)`.
 *
 * @internal — finding-b fix
 */
function registerLoopError(ctx: LoopContext, cause: unknown): void {
  if (ctx.error !== undefined) return;
  const rawMessage = (cause as { message?: unknown } | null | undefined)?.message;
  const message =
    typeof rawMessage === "string"
      ? rawMessage
      : cause instanceof Error
        ? cause.message
        : String(cause);
  const rawCode = (cause as { code?: unknown } | null | undefined)?.code;
  const code = typeof rawCode === "string" ? rawCode : undefined;
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
  let errored = false;
  let finishValue: CollectedEvents["finishValue"];
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
    if (next.value.type === "error") {
      // Finding-B fix: LLM in-stream error event MUST surface via
      // ctx.error (set-once), NEVER as an assistant message. EC-1
      // typeof guard inside registerLoopError covers `next.value.code`.
      registerLoopError(ctx, next.value);
      ctx.finalText = "";
      errored = true;
      break;
    }
  }
  return { accumulatedText, errored, finishValue };
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

async function collectTools(mcp: Map<string, McpClient>): Promise<ResolvedTool[]> {
  const tools: ResolvedTool[] = [
    {
      name: "shell",
      description: "Run a shell command in the workspace and return stdout/stderr.",
      inputSchema: {
        type: "object",
        required: ["command"],
        properties: { command: { type: "string", description: "The shell command to run." } },
      },
      origin: "shell",
    },
  ];
  for (const [serverName, client] of mcp.entries()) {
    const mcpTools = await safeListTools(client);
    for (const tool of mcpTools) {
      tools.push({
        name: `mcp_${sanitize(serverName)}_${sanitize(tool.name)}`,
        description: tool.description,
        inputSchema: tool.inputSchema,
        origin: "mcp",
        mcpServerName: serverName,
        mcpToolName: tool.name,
      });
    }
  }
  return tools;
}

async function safeListTools(client: McpClient): Promise<McpTool[]> {
  try {
    return await client.listTools();
  } catch {
    return [];
  }
}

function toLlmTool(tool: ResolvedTool): LlmTool {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

function buildSystemEvent(inputs: AgentLoopInputs, toolNames: string[]): SDKSystemMessage {
  return {
    type: "system",
    subtype: "init",
    agent_id: inputs.agentId,
    run_id: inputs.runId,
    model: inputs.model,
    tools: toolNames,
  };
}

function buildUserEvent(inputs: AgentLoopInputs): SDKUserMessageEvent {
  return {
    type: "user",
    agent_id: inputs.agentId,
    run_id: inputs.runId,
    message: { role: "user", content: [{ type: "text", text: inputs.userMessage }] },
  };
}

function buildAssistantEvent(inputs: AgentLoopInputs, text: string): SDKAssistantMessage {
  return {
    type: "assistant",
    agent_id: inputs.agentId,
    run_id: inputs.runId,
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

function buildAssistantTurn(text: string, toolCalls: LlmToolCallPart[]): LlmMessage {
  const content: LlmContentPart[] = [];
  if (text.length > 0) content.push({ type: "text", text });
  for (const call of toolCalls) content.push(call);
  return { role: "assistant", content };
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
}

/** Generate a request id for telemetry. @internal */
export function buildRequestId(): string {
  return generateRequestId();
}
