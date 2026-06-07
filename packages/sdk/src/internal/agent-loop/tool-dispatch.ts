import type { SDKMessage, SDKToolUseMessage } from "../../types/messages.js";
import { generateCallId } from "../ids.js";
import type { LlmContentPart, LlmToolCallPart } from "../llm/types.js";
import { checkToolWhitelist } from "../runtime/async-local-storage.js";
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

/**
 * T10.4 / PV#2 — `dispatchSingleCall` orchestrator split into named sub-steps.
 * Each step is a private function with a single concern; the orchestrator
 * sequences them. The previous complexity-suppression directive (over a
 * 158 LOC body with 5 origin branches inline) is no longer required after
 * the split.
 *
 * Step taxonomy:
 *  1. `applyRepairAndExtractCall` — ADRs D86-D88 repair middleware.
 *  2. `enforceForkWhitelist`      — ADR D111 fork tool-whitelist veto.
 *  3. `startToolCallSpan`         — OTel span init + repairs annotation.
 *  4. `runPluginPreToolVeto`      — ADR D101 plugin veto.
 *  5. `runFileHookPreToolVeto`    — operator-policy hook veto.
 *  6. `runToolWithLifecycle`      — exec + onToolStart/End/Error hooks.
 *  7. `finalizeSpanAndPostHook`   — span end + postToolUse + return shape.
 */
async function dispatchSingleCall(
  inputs: AgentLoopInputs,
  tools: ResolvedTool[],
  call: LlmToolCallPart,
  events: SDKMessage[],
): Promise<LlmContentPart> {
  const { call: workingCall, repairs } = applyRepairAndExtractCall(tools, call);
  const callId = generateCallId();

  const forkVeto = vetoFromForkWhitelist(inputs, workingCall, callId, events);
  if (forkVeto !== undefined) return forkVeto;

  const resolved = tools.find((tool) => tool.name === workingCall.name);
  const toolSpan = startToolCallSpan(inputs, workingCall, resolved, callId, repairs);
  events.push(buildToolUseRunning(inputs, callId, workingCall));

  const pluginVeto = await vetoFromPluginPreHook(inputs, workingCall, callId, events);
  if (pluginVeto !== undefined) return pluginVeto;

  const fileVeto = await vetoFromFileHookPreDecision(inputs, workingCall, callId, events);
  if (fileVeto !== undefined) return fileVeto;

  const result = await runToolWithLifecycle(inputs, resolved, workingCall, callId);
  return finalizeSpanAndPostHook(inputs, workingCall, callId, result, events, toolSpan);
}

interface RepairedCallShape {
  call: LlmToolCallPart;
  repairs: ReadonlyArray<string>;
}

/**
 * Step 1 — D86-D88 repair middleware. Returns the (possibly rewritten) call
 * and the list of repairs applied (used later for span annotation).
 */
function applyRepairAndExtractCall(
  tools: ResolvedTool[],
  call: LlmToolCallPart,
): RepairedCallShape {
  const registryMap = buildRepairRegistry(tools);
  const repaired = repairToolCall({ name: call.name, args: call.input, id: call.id }, registryMap);
  if (repaired.repairs.length === 0) return { call, repairs: repaired.repairs };
  return {
    call: {
      ...call,
      name: repaired.call.name,
      input: (repaired.call.args ?? {}) as Record<string, unknown>,
    },
    repairs: repaired.repairs,
  };
}

/**
 * Step 2 — D111 fork whitelist gate. Fires BEFORE plugin/file hooks because
 * a fork's allowedTools set is the strictest contract. Returns the
 * early-return content part when blocked; `undefined` to continue.
 */
function vetoFromForkWhitelist(
  inputs: AgentLoopInputs,
  call: LlmToolCallPart,
  callId: string,
  events: SDKMessage[],
): LlmContentPart | undefined {
  const whitelistDecision = checkToolWhitelist(call.name);
  if (whitelistDecision.allowed) return undefined;
  events.push(buildToolUseRunning(inputs, callId, call));
  events.push(
    buildToolUseCompleted(inputs, callId, call, {
      stdout: "",
      stderr: whitelistDecision.reason ?? "tool not available in fork",
      exitCode: 126,
    }),
  );
  return {
    type: "tool_result",
    toolUseId: call.id,
    content: `Tool blocked by fork whitelist: ${whitelistDecision.reason}`,
  };
}

/**
 * Step 3 — OTel span init + repairs/args annotation. Returns the span
 * handle (or `undefined` when telemetry is disabled) for later finalization.
 */
function startToolCallSpan(
  inputs: AgentLoopInputs,
  call: LlmToolCallPart,
  resolved: ResolvedTool | undefined,
  callId: string,
  repairs: ReadonlyArray<string>,
): ReturnType<NonNullable<AgentLoopInputs["telemetry"]>["startSpan"]> | undefined {
  const toolSpan = inputs.telemetry?.startSpan("tool.call", {
    "tool.name": call.name,
    "tool.origin": resolved?.origin ?? "unknown",
    callId,
  });
  if (repairs.length > 0 && toolSpan !== undefined) {
    toolSpan.setAttribute("tool.repairs", repairs.join("; "));
  }
  if (toolSpan !== undefined && inputs.telemetry?.includeContent === true) {
    toolSpan.addEvent("args", { input: JSON.stringify(call.input) });
  }
  return toolSpan;
}

/**
 * Step 4 — D101 plugin `pre_tool_call` veto. Plugins are author-supplied
 * (code-level safety) and fire BEFORE file hooks (operator policy).
 */
async function vetoFromPluginPreHook(
  inputs: AgentLoopInputs,
  call: LlmToolCallPart,
  callId: string,
  events: SDKMessage[],
): Promise<LlmContentPart | undefined> {
  const pluginVeto = await inputs.pluginManager?.runPreToolCallHooks({
    name: call.name,
    args: call.input,
    agentId: inputs.agentId,
    runId: inputs.runId,
  });
  if (pluginVeto === undefined) return undefined;
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

/**
 * Step 5 — file-based hooks `preToolUse` decision. Denial is surfaced as a
 * regular `tool_result` (not `isError`) so the model can react in narrative;
 * marking it `isError` would short-circuit the agent loop, which is too
 * harsh for a policy denial.
 */
async function vetoFromFileHookPreDecision(
  inputs: AgentLoopInputs,
  call: LlmToolCallPart,
  callId: string,
  events: SDKMessage[],
): Promise<LlmContentPart | undefined> {
  const preDecision = await inputs.hooks.run({
    event: "preToolUse",
    tool: call.name,
    input: call.input,
    agentId: inputs.agentId,
    runId: inputs.runId,
  });
  if (!preDecision.blocked) return undefined;
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
    content: `Hook denied this tool call: ${preDecision.reason ?? "no reason given"}`,
  };
}

/**
 * Step 6 — exec + D315-D317 onToolStart/End/Error lifecycle. Fires
 * `onToolError` when stderr/exit signals failure; otherwise `onToolEnd`.
 * The `error` field passed to `onToolError` is ALWAYS an `Error` instance.
 */
async function runToolWithLifecycle(
  inputs: AgentLoopInputs,
  resolved: ResolvedTool | undefined,
  call: LlmToolCallPart,
  callId: string,
): Promise<ToolResult> {
  const startAt = Date.now();
  await safeEmitToolHook(inputs.onToolStart, {
    toolName: call.name,
    args: call.input,
    conversationId: inputs.agentId,
    callId,
  });
  const result = await executeTool(inputs, resolved, call);
  const durationMs = Date.now() - startAt;
  if (result.exitCode !== undefined && result.exitCode !== 0 && result.exitCode !== null) {
    await safeEmitToolHook(inputs.onToolError, {
      toolName: call.name,
      args: call.input,
      error: new Error(result.stderr || `tool exited with code ${result.exitCode}`),
      conversationId: inputs.agentId,
      callId,
      durationMs,
      attempt: 1,
    });
  } else {
    await safeEmitToolHook(inputs.onToolEnd, {
      toolName: call.name,
      args: call.input,
      result: result.stdout,
      conversationId: inputs.agentId,
      callId,
      durationMs,
    });
  }
  return result;
}

/**
 * Step 7 — finalize the OTel span, emit the `tool_use_completed` event,
 * fire the `postToolUse` hook fire-and-forget, and build the
 * `tool_result` content part returned to the agent loop.
 */
function finalizeSpanAndPostHook(
  inputs: AgentLoopInputs,
  call: LlmToolCallPart,
  callId: string,
  result: ToolResult,
  events: SDKMessage[],
  toolSpan: ReturnType<NonNullable<AgentLoopInputs["telemetry"]>["startSpan"]> | undefined,
): LlmContentPart {
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

/**
 * D317 — fire-and-forget tool-lifecycle hook with error swallowed via
 * stderr warn. Single chokepoint so all three callbacks (start/end/error)
 * share the same hardening: a misbehaving listener cannot crash the agent
 * loop.
 *
 * @internal
 */
async function safeEmitToolHook<E>(
  callback: ((event: E) => void | Promise<void>) | undefined,
  event: E,
): Promise<void> {
  if (callback === undefined) return;
  try {
    await callback(event);
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`[theokit-sdk] tool lifecycle hook threw: ${msg}\n`);
  }
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
