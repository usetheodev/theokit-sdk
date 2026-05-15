import type { AgentDefinition, AgentOptions, ModelSelection } from "../../types/agent.js";
import type { ConversationTurn } from "../../types/conversation.js";
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKStatusMessage,
  SDKSystemMessage,
  SDKTaskMessage,
  SDKThinkingMessage,
  SDKToolUseMessage,
  SDKUserMessageEvent,
  SDKRequestMessage,
} from "../../types/messages.js";
import type { RunStatus, SendOptions } from "../../types/run.js";
import { generateCallId, generateRequestId } from "../ids.js";

/**
 * Pre-computed fixture script for a single Run. The local/cloud Run impls
 * play this back to consumers — events for `stream()`, finalStatus + result
 * for `wait()`, and the structured conversation for `run.conversation()`.
 *
 * @internal
 */
export interface FixtureScript {
  events: SDKMessage[];
  finalStatus: RunStatus;
  result?: string;
  cancellable: boolean;
  conversation: ConversationTurn[];
}

/**
 * Input the responder uses to pattern-match the user message and build the
 * appropriate script. Includes the full agent + send options so the responder
 * can react to context/providers/MCP/plugin/skill configuration.
 *
 * @internal
 */
export interface FixtureRequest {
  agentId: string;
  runId: string;
  model: ModelSelection;
  userMessage: string;
  runtime: "local" | "cloud";
  agentOptions: AgentOptions;
  sendOptions: SendOptions;
  workspaceCwd: string | undefined;
  subagents?: Record<string, AgentDefinition>;
  settingSourcesIncludeProject?: boolean;
}

/**
 * Dispatch the user message to a deterministic fixture response. Each
 * branch corresponds to a known test prompt in `tests/contract/**` or
 * `tests/golden/**`.
 *
 * @internal
 */
export function buildFixtureScript(request: FixtureRequest): FixtureScript {
  if (request.runtime === "cloud") return buildCloudScript(request);
  return buildLocalScript(request);
}

function buildLocalScript(request: FixtureRequest): FixtureScript {
  const message = request.userMessage;

  if (message.includes("Run npm run slow")) {
    return slowRunScript(request);
  }
  if (message.includes("Run npm run fail") || message.includes("failing-tool")) {
    return errorRunScript(request);
  }
  if (message.includes("Return only:")) {
    return returnOnlyScript(request);
  }
  if (
    message.includes("ask for approval before editing") ||
    message.includes("Use shell to inspect src/index.js, then answer")
  ) {
    return shellWithApprovalScript(request);
  }
  if (message.includes("Run two shell commands")) {
    return twoShellCommandsScript(request);
  }
  if (message.includes("Run ls and explain")) {
    return shellExplainScript(request);
  }
  if (
    message.includes("exported answer") ||
    message.includes("report the exported answer")
  ) {
    return returnAnswerScript(request, "The answer is 42.");
  }
  return defaultFinishedScript(request);
}

function returnAnswerScript(request: FixtureRequest, answer: string): FixtureScript {
  const callId = generateCallId();
  return {
    events: [
      systemEvent(request, ["shell"]),
      userEvent(request),
      toolCallCompleted(request, callId, "shell"),
      assistantText(request, answer),
    ],
    finalStatus: "finished",
    result: answer,
    cancellable: false,
    conversation: assistantOnlyConversation(answer),
  };
}

function buildCloudScript(request: FixtureRequest): FixtureScript {
  const events: SDKMessage[] = [
    systemEvent(request, []),
    userEvent(request),
    cloudStatus(request, "CREATING"),
    cloudStatus(request, "RUNNING"),
    assistantText(request, "Cloud run completed."),
    cloudStatus(request, "FINISHED"),
  ];
  return {
    events,
    finalStatus: "finished",
    result: "Cloud run completed.",
    cancellable: false,
    conversation: assistantOnlyConversation("Cloud run completed."),
  };
}

function slowRunScript(request: FixtureRequest): FixtureScript {
  const events: SDKMessage[] = [
    systemEvent(request, ["shell"]),
    userEvent(request),
    assistantText(request, "Starting the slow command..."),
  ];
  return {
    events,
    finalStatus: "cancelled",
    cancellable: true,
    conversation: assistantOnlyConversation("Starting the slow command..."),
  };
}

function errorRunScript(request: FixtureRequest): FixtureScript {
  const events: SDKMessage[] = [
    systemEvent(request, ["shell"]),
    userEvent(request),
    assistantText(request, "Command failed"),
  ];
  return {
    events,
    finalStatus: "error",
    result: "Command failed",
    cancellable: false,
    conversation: assistantOnlyConversation("Command failed"),
  };
}

function returnOnlyScript(request: FixtureRequest): FixtureScript {
  const trimmed = request.userMessage.replace(/^.*Return only:\s*/i, "").trim();
  const text = trimmed.length === 0 ? "The answer is 42." : trimmed;
  return {
    events: [
      systemEvent(request, ["shell"]),
      userEvent(request),
      assistantText(request, text),
    ],
    finalStatus: "finished",
    result: text,
    cancellable: false,
    conversation: assistantOnlyConversation(text),
  };
}

function shellWithApprovalScript(request: FixtureRequest): FixtureScript {
  const callId = generateCallId();
  const events: SDKMessage[] = [
    systemEvent(request, ["shell"]),
    userEvent(request),
    thinkingEvent(request, "Plan: inspect index.js, then ask before editing."),
    toolCallCompleted(request, callId, "shell"),
    assistantText(request, "The answer is 42."),
    taskEvent(request, "inspection-complete"),
    requestEvent(request),
  ];
  return {
    events,
    finalStatus: "finished",
    result: "The answer is 42.",
    cancellable: false,
    conversation: [
      ...assistantOnlyConversation("The answer is 42."),
    ],
  };
}

function twoShellCommandsScript(request: FixtureRequest): FixtureScript {
  const call1 = generateCallId();
  const call2 = generateCallId();
  return {
    events: [
      systemEvent(request, ["shell"]),
      userEvent(request),
      toolCallRunning(request, call1, "shell"),
      toolCallCompleted(request, call1, "shell"),
      toolCallRunning(request, call2, "shell"),
      toolCallCompleted(request, call2, "shell"),
      assistantText(request, "Both commands completed."),
    ],
    finalStatus: "finished",
    result: "Both commands completed.",
    cancellable: false,
    conversation: assistantOnlyConversation("Both commands completed."),
  };
}

function shellExplainScript(request: FixtureRequest): FixtureScript {
  const callId = generateCallId();
  return {
    events: [
      systemEvent(request, ["shell"]),
      userEvent(request),
      toolCallCompleted(request, callId, "shell"),
      assistantText(request, "ls succeeded and src/index.js exports answer()."),
    ],
    finalStatus: "finished",
    result: "ls succeeded and src/index.js exports answer().",
    cancellable: false,
    conversation: [
      {
        type: "agentConversationTurn",
        turn: {
          userMessage: { text: request.userMessage },
          steps: [
            { type: "assistantMessage", message: { text: "Reviewing src/index.js." } },
            {
              type: "toolCall",
              message: { callId, name: "shell" },
            },
          ],
        },
      },
      {
        type: "shellConversationTurn",
        turn: {
          shellCommand: { command: "ls" },
          shellOutput: { stdout: "src\npackage.json\n", stderr: "", exitCode: 0 },
        },
      },
    ],
  };
}

function defaultFinishedScript(request: FixtureRequest): FixtureScript {
  const text = "Done.";
  return {
    events: [
      systemEvent(request, ["shell"]),
      userEvent(request),
      assistantText(request, text),
    ],
    finalStatus: "finished",
    result: text,
    cancellable: false,
    conversation: assistantOnlyConversation(text),
  };
}

function assistantOnlyConversation(text: string): ConversationTurn[] {
  return [
    {
      type: "agentConversationTurn",
      turn: {
        steps: [{ type: "assistantMessage", message: { text } }],
      },
    },
  ];
}

function systemEvent(request: FixtureRequest, tools: string[]): SDKSystemMessage {
  return {
    type: "system",
    subtype: "init",
    agent_id: request.agentId,
    run_id: request.runId,
    model: request.model,
    tools,
  };
}

function userEvent(request: FixtureRequest): SDKUserMessageEvent {
  return {
    type: "user",
    agent_id: request.agentId,
    run_id: request.runId,
    message: { role: "user", content: [{ type: "text", text: request.userMessage }] },
  };
}

function assistantText(request: FixtureRequest, text: string): SDKAssistantMessage {
  return {
    type: "assistant",
    agent_id: request.agentId,
    run_id: request.runId,
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

function thinkingEvent(request: FixtureRequest, text: string): SDKThinkingMessage {
  return {
    type: "thinking",
    agent_id: request.agentId,
    run_id: request.runId,
    text,
  };
}

function toolCallRunning(
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

function toolCallCompleted(
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

function cloudStatus(
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

function taskEvent(request: FixtureRequest, status: string): SDKTaskMessage {
  return {
    type: "task",
    agent_id: request.agentId,
    run_id: request.runId,
    status,
  };
}

function requestEvent(request: FixtureRequest): SDKRequestMessage {
  return {
    type: "request",
    agent_id: request.agentId,
    run_id: request.runId,
    request_id: generateRequestId(),
  };
}
