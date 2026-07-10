import { ToolError } from "../../tool-error.js";
import type { ToolResultContentBlock } from "../../types/content-blocks.js";
import type { LlmToolCallPart } from "../llm/types.js";
import { runShell, type ShellExecuteOptions } from "../runtime/tools/shell-tool.js";
import type { AgentLoopInputs, ResolvedTool } from "./loop-types.js";

/** @internal */
export interface ToolResult {
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  /**
   * SE7 — authoritative tool_result content when set: a string OR structured
   * blocks (text + image). Populated by a handler that returns blocks, or a
   * `ToolError` (string or blocks); `stdout`/`stderr` remain for hooks/telemetry.
   * `undefined` → the legacy string path (`renderToolResult` over stdout/stderr).
   */
  content?: string | ToolResultContentBlock[];
}

/** @internal */
export async function executeTool(
  inputs: AgentLoopInputs,
  resolved: ResolvedTool | undefined,
  call: LlmToolCallPart,
): Promise<ToolResult> {
  if (resolved === undefined) {
    return { stdout: "", stderr: `Unknown tool ${call.name}`, exitCode: 127 };
  }
  if (resolved.origin === "shell") return runShellTool(inputs, call);
  if (resolved.origin === "memory") return runMemoryTool(resolved, call, inputs.context);
  if (resolved.origin === "custom")
    return runCustomTool(resolved, call, inputs.signal, inputs.context);
  return runMcpTool(inputs, resolved, call);
}

async function runMemoryTool(
  resolved: ResolvedTool,
  call: LlmToolCallPart,
  context?: unknown,
): Promise<ToolResult> {
  return runHandlerTool("memory", resolved.memoryHandler, call, undefined, context);
}

async function runCustomTool(
  resolved: ResolvedTool,
  call: LlmToolCallPart,
  signal?: AbortSignal,
  context?: unknown,
): Promise<ToolResult> {
  return runHandlerTool("custom", resolved.customHandler, call, signal, context);
}

async function runHandlerTool(
  kind: "memory" | "custom",
  handler:
    | ((
        input: Record<string, unknown>,
        ctx?: { signal?: AbortSignal; context?: unknown },
      ) => string | ToolResultContentBlock[] | Promise<string | ToolResultContentBlock[]>)
    | undefined,
  call: LlmToolCallPart,
  signal?: AbortSignal,
  context?: unknown,
): Promise<ToolResult> {
  if (handler === undefined) {
    return { stdout: "", stderr: `${kind} tool ${call.name} has no handler`, exitCode: 127 };
  }
  try {
    // #65 — the run's abort signal on the ToolContext. M7 — also the run's user
    // `context` (from SendOptions.context), so tools read shared config (e.g.
    // projectRoot) set once at the run. Single-arg handlers ignore both.
    const out = await handler(call.input, { signal, context });
    // SE7 — a handler may return structured content blocks (text + image).
    if (typeof out !== "string") return { stdout: "", stderr: "", exitCode: 0, content: out };
    return { stdout: out, stderr: "", exitCode: 0 };
  } catch (cause) {
    // SE7 — a `ToolError` carries the error content (string or blocks) as the
    // authoritative tool_result content; `stderr` keeps the text message for the
    // `onToolError` hook. A string ToolError stays a string on the wire (symmetric
    // with a string handler return), a block ToolError carries its blocks.
    if (cause instanceof ToolError) {
      return { stdout: "", stderr: cause.message, exitCode: 1, content: cause.content };
    }
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

/** @internal */
export function renderToolResult(result: ToolResult): string {
  if (result.stderr.length > 0 && (result.exitCode ?? 0) !== 0) {
    return `${result.stdout}\n[stderr]\n${result.stderr}`.trim();
  }
  return result.stdout.trim();
}
