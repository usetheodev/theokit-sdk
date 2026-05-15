import type { ConversationTurn } from "../../types/conversation.js";
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKSystemMessage,
  SDKUserMessageEvent,
} from "../../types/messages.js";
import type { RunStatus } from "../../types/run.js";
import { generateRequestId } from "../ids.js";
import type {
  LlmClient,
  LlmContentPart,
  LlmMessage,
  LlmTool,
  LlmToolCallPart,
} from "../llm/types.js";
import type { McpClient, McpTool } from "../mcp/client.js";
import { safeCall } from "../runtime/system-prompt/safe-call.js";
import type { AgentLoopInputs, AgentLoopOutput } from "./loop-types.js";
import { dispatchTools, type ResolvedTool } from "./tool-dispatch.js";

/**
 * The real agent loop. Given an LLM client, MCP clients, hooks, and a shell
 * runner, it drives the LLM-tool-LLM cycle until the model stops. All
 * intermediate states surface as `SDKMessage` events so the caller can
 * stream them through `Run.stream()`.
 *
 * @internal
 */

export type { AgentLoopInputs, AgentLoopOutput } from "./loop-types.js";

export async function runAgentLoop(inputs: AgentLoopInputs): Promise<AgentLoopOutput> {
  const ctx = await initLoopContext(inputs);
  const maxIterations = inputs.maxIterations ?? 8;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const decision = await runIteration(inputs, ctx);
    if (decision === "done") break;
    if (decision === "error") {
      ctx.finalStatus = "error";
      break;
    }
  }
  return {
    events: ctx.events,
    finalStatus: ctx.finalStatus,
    result: ctx.finalText,
    conversation: ctx.conversation,
  };
}

interface LoopContext {
  events: SDKMessage[];
  conversation: ConversationTurn[];
  messages: LlmMessage[];
  tools: ResolvedTool[];
  finalText: string;
  finalStatus: RunStatus;
}

async function initLoopContext(inputs: AgentLoopInputs): Promise<LoopContext> {
  const tools = await collectTools(inputs.mcp);
  const events: SDKMessage[] = [
    buildSystemEvent(
      inputs,
      tools.map((t) => t.name),
    ),
    buildUserEvent(inputs),
  ];
  return {
    events,
    conversation: [],
    messages: [{ role: "user", content: [{ type: "text", text: inputs.userMessage }] }],
    tools,
    finalText: "",
    finalStatus: "finished",
  };
}

async function runIteration(
  inputs: AgentLoopInputs,
  ctx: LoopContext,
): Promise<"continue" | "done" | "error"> {
  const llmOutput = await streamLlmTurn(inputs, ctx);
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
}

async function streamLlmTurn(inputs: AgentLoopInputs, ctx: LoopContext): Promise<LlmTurnOutput> {
  const signal = new AbortController().signal;
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
  return {
    text: collected.accumulatedText,
    toolCalls: result.toolCalls,
    stopReason: result.stopReason,
    errored: false,
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
  while (true) {
    const next = await generator.next();
    if (next.done === true) {
      finishValue = next;
      break;
    }
    if (next.value.type === "text_delta") {
      accumulatedText += next.value.text;
      if (inputs.onDelta !== undefined) {
        const cb = inputs.onDelta;
        const text = next.value.text;
        await safeCall(
          () => cb({ update: { type: "text-delta", text } }),
          undefined,
          "SendOptions.onDelta",
        );
      }
    }
    if (next.value.type === "error") {
      ctx.finalText = next.value.message;
      ctx.events.push(buildAssistantEvent(inputs, next.value.message));
      errored = true;
      break;
    }
  }
  return { accumulatedText, errored, finishValue };
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
