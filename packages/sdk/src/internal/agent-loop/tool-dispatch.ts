import type { SDKMessage, SDKToolUseMessage } from "../../types/messages.js";
import { generateCallId } from "../ids.js";
import type { LlmContentPart, LlmToolCallPart } from "../llm/types.js";
import { runShell, type ShellExecuteOptions } from "../runtime/shell-tool.js";
import { type RepairableTool, repairToolCall } from "../tool-dispatch/repair-middleware.js";
import type { AgentLoopInputs } from "./loop-types.js";

/**
 * Tool dispatch helpers extracted from the main agent loop. Each call goes
 * through `dispatchSingleCall` which fires `preToolUse` hooks, executes the
 * tool (shell or MCP), and fires `postToolUse` after capturing the result.
 *
 * @internal
 */

export interface ResolvedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  origin: "shell" | "mcp" | "memory" | "custom";
  mcpServerName?: string;
  mcpToolName?: string;
  /** Direct handler for `origin === "memory"` tools — returns JSON-encoded result string. */
  memoryHandler?: (input: Record<string, unknown>) => Promise<string>;
  /** Direct handler for `origin === "custom"` tools — user-supplied via `AgentOptions.tools`. */
  customHandler?: (input: Record<string, unknown>) => string | Promise<string>;
}

interface ToolResult {
  stdout: string;
  stderr: string;
  exitCode?: number | null;
}

export async function dispatchTools(
  inputs: AgentLoopInputs,
  tools: ResolvedTool[],
  toolCalls: LlmToolCallPart[],
  events: SDKMessage[],
): Promise<LlmContentPart[]> {
  const out: LlmContentPart[] = [];
  for (const call of toolCalls) {
    out.push(await dispatchSingleCall(inputs, tools, call, events));
  }
  return out;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: tool dispatch must check 5 origins (custom/mcp/builtin/handler-tool/missing) and emit running+completed events for each — branching is mirroring the public taxonomy.
async function dispatchSingleCall(
  inputs: AgentLoopInputs,
  tools: ResolvedTool[],
  call: LlmToolCallPart,
  events: SDKMessage[],
): Promise<LlmContentPart> {
  // T4.1 (ADRs D86-D88): apply repair middleware BEFORE the lookup so
  // case-insensitive matches, JSON-stringified args, and type coercion all
  // land before the registry check. Repairs are surfaced via telemetry.
  const registryMap = buildRepairRegistry(tools);
  const repaired = repairToolCall({ name: call.name, args: call.input, id: call.id }, registryMap);
  if (repaired.repairs.length > 0) {
    call = {
      ...call,
      name: repaired.call.name,
      input: (repaired.call.args ?? {}) as Record<string, unknown>,
    };
  }
  const resolved = tools.find((tool) => tool.name === call.name);
  const callId = generateCallId();
  const toolSpan = inputs.telemetry?.startSpan("tool.call", {
    "tool.name": call.name,
    "tool.origin": resolved?.origin ?? "unknown",
    callId,
  });
  if (repaired.repairs.length > 0 && toolSpan !== undefined) {
    toolSpan.setAttribute("tool.repairs", repaired.repairs.join("; "));
  }
  if (toolSpan !== undefined && inputs.telemetry?.includeContent === true) {
    toolSpan.addEvent("args", { input: JSON.stringify(call.input) });
  }
  events.push(buildToolUseRunning(inputs, callId, call));
  // T4.2 (ADR D101): plugin `pre_tool_call` hooks fire BEFORE file-based
  // hooks. Plugins are author-supplied (code-level safety); file-based
  // hooks are operator policy. Author intent wins early.
  const pluginVeto = await inputs.pluginManager?.runPreToolCallHooks({
    name: call.name,
    args: call.input,
    agentId: inputs.agentId,
    runId: inputs.runId,
  });
  if (pluginVeto !== undefined) {
    events.push(
      buildToolUseCompleted(inputs, callId, call, {
        stdout: "",
        stderr: pluginVeto.message,
        exitCode: 126,
      }),
    );
    return {
      type: "tool_result",
      toolUseId: call.id,
      content: `Plugin blocked this tool call: ${pluginVeto.message}`,
    };
  }
  const preDecision = await inputs.hooks.run({
    event: "preToolUse",
    tool: call.name,
    input: call.input,
    agentId: inputs.agentId,
    runId: inputs.runId,
  });
  if (preDecision.blocked) {
    events.push(
      buildToolUseCompleted(inputs, callId, call, {
        stdout: "",
        stderr: preDecision.reason ?? "blocked by hook",
        exitCode: 126,
      }),
    );
    // Surface the denial as a regular tool_result so the model can react
    // (explain to the user, try a different command, etc.). Marking it
    // `isError` would short-circuit the agent loop, which is too harsh —
    // a policy denial is expected behaviour, not a runtime failure.
    return {
      type: "tool_result",
      toolUseId: call.id,
      content: `Hook denied this tool call: ${preDecision.reason ?? "no reason given"}`,
    };
  }
  const result = await executeTool(inputs, resolved, call);
  toolSpan?.setAttribute("exitCode", result.exitCode ?? 0);
  if (toolSpan !== undefined && inputs.telemetry?.includeContent === true) {
    toolSpan.addEvent("result", { stdout: result.stdout.slice(0, 1000) });
  }
  toolSpan?.end();
  events.push(buildToolUseCompleted(inputs, callId, call, result));
  void inputs.hooks.run({
    event: "postToolUse",
    tool: call.name,
    input: call.input,
    output: {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0,
    },
    agentId: inputs.agentId,
    runId: inputs.runId,
  });
  return {
    type: "tool_result",
    toolUseId: call.id,
    content: renderToolResult(result),
    ...(result.exitCode !== 0 && result.exitCode !== undefined ? { isError: true } : {}),
  };
}

async function executeTool(
  inputs: AgentLoopInputs,
  resolved: ResolvedTool | undefined,
  call: LlmToolCallPart,
): Promise<ToolResult> {
  if (resolved === undefined) {
    return { stdout: "", stderr: `Unknown tool ${call.name}`, exitCode: 127 };
  }
  if (resolved.origin === "shell") return runShellTool(inputs, call);
  if (resolved.origin === "memory") return runMemoryTool(resolved, call);
  if (resolved.origin === "custom") return runCustomTool(resolved, call);
  return runMcpTool(inputs, resolved, call);
}

async function runMemoryTool(resolved: ResolvedTool, call: LlmToolCallPart): Promise<ToolResult> {
  return runHandlerTool("memory", resolved.memoryHandler, call);
}

async function runCustomTool(resolved: ResolvedTool, call: LlmToolCallPart): Promise<ToolResult> {
  return runHandlerTool("custom", resolved.customHandler, call);
}

/**
 * Shared dispatch path for in-process handler tools (memory + custom). Wraps
 * the handler call in try/catch and converts the result into the uniform
 * stdout/stderr/exitCode shape the agent loop consumes.
 */
async function runHandlerTool(
  kind: "memory" | "custom",
  handler: ((input: Record<string, unknown>) => string | Promise<string>) | undefined,
  call: LlmToolCallPart,
): Promise<ToolResult> {
  if (handler === undefined) {
    return { stdout: "", stderr: `${kind} tool ${call.name} has no handler`, exitCode: 127 };
  }
  try {
    const stdout = await handler(call.input);
    return { stdout, stderr: "", exitCode: 0 };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { stdout: "", stderr: message, exitCode: 1 };
  }
}

async function runShellTool(inputs: AgentLoopInputs, call: LlmToolCallPart): Promise<ToolResult> {
  const command =
    typeof call.input.command === "string" ? call.input.command : JSON.stringify(call.input);
  const shellOptions: ShellExecuteOptions = {
    command,
    cwd: inputs.shellCwd,
    sandbox: inputs.shellSandbox,
  };
  const result = await runShell(shellOptions);
  const final: ToolResult = { stdout: result.stdout, stderr: result.stderr };
  if (result.exitCode !== null && result.exitCode !== undefined) final.exitCode = result.exitCode;
  return final;
}

async function runMcpTool(
  inputs: AgentLoopInputs,
  resolved: ResolvedTool,
  call: LlmToolCallPart,
): Promise<ToolResult> {
  const client = inputs.mcp.get(resolved.mcpServerName ?? "");
  if (client === undefined || resolved.mcpToolName === undefined) {
    return {
      stdout: "",
      stderr: `MCP server ${resolved.mcpServerName ?? "?"} not connected`,
      exitCode: 127,
    };
  }
  try {
    const response = await client.callTool(resolved.mcpToolName, call.input);
    const text = response.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    return { stdout: text, stderr: "", exitCode: response.isError === true ? 1 : 0 };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { stdout: "", stderr: message, exitCode: 1 };
  }
}

function renderToolResult(result: ToolResult): string {
  if (result.stderr.length > 0 && (result.exitCode ?? 0) !== 0) {
    return `${result.stdout}\n[stderr]\n${result.stderr}`.trim();
  }
  return result.stdout.trim();
}

function buildToolUseRunning(
  inputs: AgentLoopInputs,
  callId: string,
  call: LlmToolCallPart,
): SDKToolUseMessage {
  return {
    type: "tool_call",
    agent_id: inputs.agentId,
    run_id: inputs.runId,
    call_id: callId,
    name: call.name,
    status: "running",
    args: call.input,
  };
}

/**
 * T4.1 helper: project the agent-loop's ResolvedTool[] into a registry
 * shape consumable by `repairToolCall`. Caller owns the Map lifetime
 * (rebuilt each dispatchSingleCall — O(tools.length) overhead is negligible
 * compared to the LLM round-trip).
 */
function buildRepairRegistry(tools: ResolvedTool[]): ReadonlyMap<string, RepairableTool> {
  const out = new Map<string, RepairableTool>();
  for (const t of tools) {
    out.set(t.name, { name: t.name, inputSchema: t.inputSchema });
  }
  return out;
}

function buildToolUseCompleted(
  inputs: AgentLoopInputs,
  callId: string,
  call: LlmToolCallPart,
  result: ToolResult,
): SDKToolUseMessage {
  return {
    type: "tool_call",
    agent_id: inputs.agentId,
    run_id: inputs.runId,
    call_id: callId,
    name: call.name,
    status: "completed",
    args: call.input,
    result: {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0,
    },
  };
}
