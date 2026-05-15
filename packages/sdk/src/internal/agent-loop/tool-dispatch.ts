import type { SDKMessage, SDKToolUseMessage } from "../../types/messages.js";
import { generateCallId } from "../ids.js";
import type { LlmContentPart, LlmToolCallPart } from "../llm/types.js";
import { runShell, type ShellExecuteOptions } from "../runtime/shell-tool.js";
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
  origin: "shell" | "mcp";
  mcpServerName?: string;
  mcpToolName?: string;
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

async function dispatchSingleCall(
  inputs: AgentLoopInputs,
  tools: ResolvedTool[],
  call: LlmToolCallPart,
  events: SDKMessage[],
): Promise<LlmContentPart> {
  const resolved = tools.find((tool) => tool.name === call.name);
  const callId = generateCallId();
  events.push(buildToolUseRunning(inputs, callId, call));
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
    return {
      type: "tool_result",
      toolUseId: call.id,
      content: `Hook denied: ${preDecision.reason ?? "no reason given"}`,
      isError: true,
    };
  }
  const result = await executeTool(inputs, resolved, call);
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
  return runMcpTool(inputs, resolved, call);
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
