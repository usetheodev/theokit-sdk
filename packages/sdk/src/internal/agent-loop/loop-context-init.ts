import type { CustomTool, SDKAgent } from "../../types/agent.js";
import type { SDKMessage } from "../../types/messages.js";
import { UsageAccumulator } from "../budget/usage-accumulator.js";
import type { LlmMessage } from "../llm/types.js";
import type { McpClient, McpTool } from "../mcp/client.js";
import type { MemoryProviderHandle } from "../runtime/memory/memory-provider.js";
import { createDoomLoopTracker, type DoomLoopTracker } from "./doom-loop-tracker.js";
import type { AgentLoopInputs } from "./loop-types.js";
import { buildSystemEvent, buildUserEvent } from "./message-builders.js";
import type { ResolvedTool } from "./tool-dispatch.js";

/**
 * Mutable state for the agent loop. Extracted to share the shape between
 * `initLoopContext` and the main loop in `loop.ts`.
 *
 * @internal
 */
export interface LoopContext {
  events: SDKMessage[];
  conversation: import("../../types/conversation.js").ConversationTurn[];
  messages: LlmMessage[];
  tools: ResolvedTool[];
  finalText: string;
  finalStatus: import("../../types/run.js").RunStatus;
  /**
   * M1-2 (T2.2): set true when the loop stopped because it exhausted the
   * iteration budget while the model still wanted to call tools (silent
   * truncation), as opposed to a clean `done` finish. Threaded onto
   * `AgentLoopOutput` → `RunResult.stoppedAtIterationLimit`.
   */
  stoppedAtIterationLimit?: boolean;
  /**
   * Doom-loop guard: set true when the loop stopped because the model repeated IDENTICAL tool calls
   * to the hard threshold (no progress). Threaded onto `AgentLoopOutput` → `RunResult.stoppedByDoomLoop`.
   */
  stoppedByDoomLoop?: boolean;
  /** Per-run doom-loop detector; `undefined` when disabled via `SendOptions.doomLoop: false`. */
  doomLoop?: DoomLoopTracker;
  usage: UsageAccumulator;
  error?: import("./loop-types.js").AgentLoopErrorDetail;
  nudgeAttempts: number;
  /** M1-4: count of honored `stop`-hook feedback re-prompts, bounded by MAX_STOP_FEEDBACK_ATTEMPTS. */
  stopFeedbackAttempts: number;
  _consecutiveToolErrors?: number;
  memoryProviderHandle?: MemoryProviderHandle;
  memorySystemPromptAdditions?: string;
}

/**
 * Build the minimal `SDKAgent` view for MemoryProvider hooks.
 * @internal
 */
export function buildAgentRef(inputs: AgentLoopInputs): SDKAgent {
  return {
    agentId: inputs.agentId,
    model: inputs.model,
  } as SDKAgent;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: pre-existing complexity from sdk-2-0 Phase 1 memory wiring (T1.5.1-T1.5.3). Refactor deferred to Phase 5 cleanup.
export async function initLoopContext(inputs: AgentLoopInputs): Promise<LoopContext> {
  let memoryProviderHandle: MemoryProviderHandle | undefined;
  if (inputs.memoryProvider !== undefined) {
    try {
      memoryProviderHandle = await inputs.memoryProvider.init({
        cwd: process.cwd(),
      });
    } catch {
      memoryProviderHandle = undefined;
    }
  }
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
  if (inputs.memoryProvider !== undefined && memoryProviderHandle !== undefined) {
    let providerTools: ReadonlyArray<CustomTool> = [];
    try {
      providerTools = inputs.memoryProvider.buildTools(memoryProviderHandle, buildAgentRef(inputs));
    } catch {
      providerTools = [];
    }
    for (const providerTool of providerTools) {
      tools.push({
        name: providerTool.name,
        description: providerTool.description,
        inputSchema: providerTool.inputSchema,
        origin: "custom",
        customHandler: providerTool.handler,
      });
    }
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
  let memorySystemPromptAdditions: string | undefined;
  if (inputs.memoryProvider !== undefined && memoryProviderHandle !== undefined) {
    try {
      const passResult = await inputs.memoryProvider.runActivePass(memoryProviderHandle, {
        userMessage: inputs.userMessage,
        history: (inputs.priorMessages ?? []).map((msg) => ({
          role: msg.role,
          content: msg.text,
        })),
        agentId: inputs.agentId,
      });
      if (
        passResult.systemPromptAdditions !== undefined &&
        passResult.systemPromptAdditions.length > 0
      ) {
        memorySystemPromptAdditions = passResult.systemPromptAdditions;
      }
    } catch {
      memorySystemPromptAdditions = undefined;
    }
  }
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
    doomLoop: createDoomLoopTracker(inputs.doomLoop),
    usage: new UsageAccumulator(),
    nudgeAttempts: 0,
    stopFeedbackAttempts: 0,
    ...(memoryProviderHandle !== undefined ? { memoryProviderHandle } : {}),
    ...(memorySystemPromptAdditions !== undefined ? { memorySystemPromptAdditions } : {}),
  };
}

/**
 * Lists tools from an MCP client with structured-stderr diagnostic on failure.
 * Exported for unit-test access to the catch path; internal-only.
 * @internal
 */
export async function safeListTools(client: McpClient, serverName?: string): Promise<McpTool[]> {
  try {
    return await client.listTools();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const server = serverName ?? "unknown";
    process.stderr.write(`[theokit-sdk] mcp listTools failed (server=${server}): ${message}\n`);
    return [];
  }
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
    const mcpTools = await safeListTools(client, serverName);
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

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
}
