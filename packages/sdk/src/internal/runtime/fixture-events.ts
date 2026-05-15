import type { ConversationTurn } from "../../types/conversation.js";
import type {
  SDKAssistantMessage,
  SDKRequestMessage,
  SDKStatusMessage,
  SDKSystemMessage,
  SDKTaskMessage,
  SDKThinkingMessage,
  SDKToolUseMessage,
  SDKUserMessageEvent,
} from "../../types/messages.js";
import { generateRequestId } from "../ids.js";
import type { FixtureRequest } from "./fixture-types.js";

/**
 * Low-level event builders + tool-list helper used by the fixture script
 * builders. Kept in a dedicated module so individual builder files stay
 * focused on their specific script shape rather than event plumbing.
 *
 * @internal
 */

export function assistantOnlyConversation(text: string): ConversationTurn[] {
  return [
    {
      type: "agentConversationTurn",
      turn: {
        steps: [{ type: "assistantMessage", message: { text } }],
      },
    },
  ];
}

export function systemEvent(request: FixtureRequest, tools: string[]): SDKSystemMessage {
  return {
    type: "system",
    subtype: "init",
    agent_id: request.agentId,
    run_id: request.runId,
    model: request.model,
    tools,
  };
}

export function userEvent(request: FixtureRequest): SDKUserMessageEvent {
  return {
    type: "user",
    agent_id: request.agentId,
    run_id: request.runId,
    message: { role: "user", content: [{ type: "text", text: request.userMessage }] },
  };
}

export function assistantText(request: FixtureRequest, text: string): SDKAssistantMessage {
  return {
    type: "assistant",
    agent_id: request.agentId,
    run_id: request.runId,
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

export function thinkingEvent(request: FixtureRequest, text: string): SDKThinkingMessage {
  return {
    type: "thinking",
    agent_id: request.agentId,
    run_id: request.runId,
    text,
  };
}

export function toolCallRunning(
  request: FixtureRequest,
  callId: string,
  name: string,
): SDKToolUseMessage {
  return {
    type: "tool_call",
    agent_id: request.agentId,
    run_id: request.runId,
    call_id: callId,
    name,
    status: "running",
    args: { command: "fixture" },
  };
}

export function toolCallCompleted(
  request: FixtureRequest,
  callId: string,
  name: string,
): SDKToolUseMessage {
  return {
    type: "tool_call",
    agent_id: request.agentId,
    run_id: request.runId,
    call_id: callId,
    name,
    status: "completed",
    args: { command: "fixture" },
    result: { stdout: "ok", exitCode: 0 },
  };
}

export function cloudStatus(
  request: FixtureRequest,
  status: SDKStatusMessage["status"],
): SDKStatusMessage {
  return {
    type: "status",
    agent_id: request.agentId,
    run_id: request.runId,
    status,
  };
}

export function taskEvent(request: FixtureRequest, status: string): SDKTaskMessage {
  return {
    type: "task",
    agent_id: request.agentId,
    run_id: request.runId,
    status,
  };
}

export function requestEvent(request: FixtureRequest): SDKRequestMessage {
  return {
    type: "request",
    agent_id: request.agentId,
    run_id: request.runId,
    request_id: generateRequestId(),
  };
}

export function defaultLocalTools(request: FixtureRequest): string[] {
  const tools: string[] = ["shell"];
  const inlineMcp = request.sendOptions.mcpServers ?? request.agentOptions.mcpServers;
  if (inlineMcp !== undefined) {
    for (const name of Object.keys(inlineMcp)) {
      tools.push(`mcp_${sanitizeMcpName(name)}_call`);
    }
  }
  if (request.settingSourcesIncludeProject) {
    for (const name of Object.keys(request.projectMcpServers)) {
      tools.push(`mcp_${sanitizeMcpName(name)}_call`);
    }
  }
  const plugins = request.agentOptions.plugins;
  if (plugins?.enabled !== undefined) {
    for (const _pluginName of plugins.enabled) {
      tools.push("mcp_search_provider_web_search");
    }
  }
  return tools;
}

function sanitizeMcpName(name: string): string {
  // Replace anything that's not alphanumeric or hyphen with an underscore.
  // Hyphens are preserved (some MCP server names like `fixture-shell` rely
  // on them being stable in the public tool list).
  return name.replace(/[^a-zA-Z0-9-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
}
