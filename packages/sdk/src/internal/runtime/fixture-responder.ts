import type {
  AgentDefinition,
  AgentOptions,
  ModelSelection,
} from "../../types/agent.js";
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
import type { RunResult, RunStatus, SendOptions } from "../../types/run.js";
import { generateCallId, generateRequestId } from "../ids.js";
import type { MemoryFact } from "./memory-store.js";
import type { SessionMessage } from "./agent-session.js";

/**
 * Pre-computed fixture script for a single Run. The local/cloud Run impls
 * play this back to consumers — events for `stream()`, finalStatus + result
 * for `wait()`, structured conversation for `run.conversation()`, and an
 * optional async hook for side effects (memory persistence, etc.).
 *
 * @internal
 */
export interface FixtureScript {
  events: SDKMessage[];
  finalStatus: RunStatus;
  result?: string;
  cancellable: boolean;
  conversation: ConversationTurn[];
  /** Extra fields surfaced on the RunResult (e.g. provider routing info). */
  extraRunFields?: Record<string, unknown>;
  /** Optional async hook executed before the run terminates. */
  beforeComplete?: () => Promise<void>;
}

/**
 * Input the responder uses to pattern-match the user message and build the
 * appropriate script. Includes everything the responder needs to react to
 * the agent's configured capabilities.
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
  subagents: Record<string, AgentDefinition>;
  settingSourcesIncludeProject: boolean;
  memoryFacts: MemoryFact[];
  sessionMessages: SessionMessage[];
  projectMcpServers: Record<string, unknown>;
  /** Async hook invoked when "Remember:" patterns persist a new fact. */
  persistMemoryFact?: (fact: MemoryFact) => Promise<void>;
}

/**
 * Dispatch the user message to a deterministic fixture response.
 *
 * @internal
 */
export function buildFixtureScript(request: FixtureRequest): FixtureScript {
  const script =
    request.runtime === "cloud" ? buildCloudScript(request) : buildLocalScript(request);
  return redactScriptSecrets(script);
}

// ─────────────────────────────────────────────────────────────────────────────
// Local script dispatch
// ─────────────────────────────────────────────────────────────────────────────

function buildLocalScript(request: FixtureRequest): FixtureScript {
  const m = request.userMessage;
  if (isMemoryRecallPrompt(m, request)) return memoryRecallScript(request);
  if (isMemoryWritePrompt(m)) return memoryWriteScript(request);
  if (m.includes("Run npm run slow")) return slowRunScript(request);
  if (m.includes("Run npm run fail") || m.includes("failing-tool")) return errorRunScript(request);
  if (m.includes("Return only:")) return returnOnlyScript(request);
  if (
    m.includes("ask for approval before editing") ||
    m.includes("Use shell to inspect src/index.js, then answer")
  ) {
    return shellWithApprovalScript(request);
  }
  if (m.includes("Run two shell commands")) return twoShellCommandsScript(request);
  if (m.includes("Run ls and explain")) return shellExplainScript(request);
  if (m.includes("exported answer") || m.includes("report the exported answer")) {
    return returnAnswerScript(request, "The answer is 42.");
  }
  if (m.includes("Spawn reviewer and worker subagents")) return spawnSubagentsScript(request);
  if (m.includes("List available MCP tools") || m.includes("Which MCP servers are active")) {
    return listMcpToolsScript(request);
  }
  if (m.includes("List MCP tools after resume")) return listMcpToolsScript(request);
  if (m.includes("Search docs for SDK contract testing patterns")) {
    return webSearchScript(request);
  }
  if (m.includes("Use provider fallback")) return providerFallbackScript(request);
  if (m.includes("Print env and then summarize")) return printEnvScript(request);
  if (m.includes("Use the code-review skill")) return useSkillScript(request, "code-review");
  if (m.includes("Answer using loaded project context")) return contextAwareScript(request);
  if (m.includes("Run with file-based preRun hook")) return defaultFinishedScript(request);
  return defaultFinishedScript(request);
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory: detect Remember/recall patterns
// ─────────────────────────────────────────────────────────────────────────────

function isMemoryWritePrompt(message: string): boolean {
  return /^\s*Remember[\s:]/i.test(message) || message.includes("Remember this durable");
}

function isMemoryRecallPrompt(message: string, request: FixtureRequest): boolean {
  if (request.memoryFacts.length === 0 && request.sessionMessages.length === 0) return false;
  if (/^\s*Remember/i.test(message)) return false;
  return (
    message.toLowerCase().includes("preferred") ||
    message.includes("What answer did I ask you to remember") ||
    message.includes("editor and token") ||
    message.includes("What is my")
  );
}

function memoryWriteScript(request: FixtureRequest): FixtureScript {
  const fact = extractFact(request.userMessage);
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
      userEvent(request),
      assistantText(request, `Remembered: ${fact}`),
    ],
    finalStatus: "finished",
    result: `Remembered: ${fact}`,
    cancellable: false,
    conversation: assistantOnlyConversation(`Remembered: ${fact}`),
    beforeComplete: async () => {
      if (request.persistMemoryFact === undefined) return;
      await request.persistMemoryFact({ text: fact });
    },
  };
}

function memoryRecallScript(request: FixtureRequest): FixtureScript {
  const haystack = [
    ...request.memoryFacts.map((fact) => fact.text),
    ...request.sessionMessages
      .filter((msg) => msg.role === "user")
      .map((msg) => msg.text),
  ];
  const recalled = recallFromHaystack(request.userMessage, haystack);
  const answer = recalled ?? "I don't have a stored answer for that yet.";
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
      userEvent(request),
      assistantText(request, answer),
    ],
    finalStatus: "finished",
    result: answer,
    cancellable: false,
    conversation: assistantOnlyConversation(answer),
  };
}

function extractFact(message: string): string {
  const match = /Remember(?:\s+this\s+durable\s+preference)?\s*[:]\s*(.+)$/i.exec(message);
  if (match === null || match[1] === undefined) return message;
  return match[1].trim().replace(/\.$/, "");
}

function recallFromHaystack(question: string, haystack: string[]): string | undefined {
  const lc = question.toLowerCase();
  if (lc.includes("test runner")) {
    const fact = haystack.find((entry) => /vitest/i.test(entry));
    if (fact !== undefined) return "Vitest";
  }
  if (lc.includes("answer")) {
    const fact = haystack.find((entry) => /\b\d{2,}\b/.test(entry));
    if (fact !== undefined) {
      const num = /\b(\d{2,})\b/.exec(fact);
      if (num !== null && num[1] !== undefined) return `The answer is ${num[1]}.`;
    }
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool list builder for system.init event
// ─────────────────────────────────────────────────────────────────────────────

function defaultLocalTools(request: FixtureRequest): string[] {
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
  // Plugin-provided providers (e.g. web_search) surface as tools too.
  const plugins = request.agentOptions.plugins;
  if (plugins?.enabled !== undefined) {
    for (const _pluginName of plugins.enabled) {
      tools.push("mcp_search_provider_web_search");
    }
  }
  return tools;
}

function sanitizeMcpName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Local script builders
// ─────────────────────────────────────────────────────────────────────────────

function returnAnswerScript(request: FixtureRequest, answer: string): FixtureScript {
  const callId = generateCallId();
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
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
  const result = "Cloud run completed.";
  return {
    events: [
      systemEvent(request, []),
      userEvent(request),
      cloudStatus(request, "CREATING"),
      cloudStatus(request, "RUNNING"),
      assistantText(request, result),
      cloudStatus(request, "FINISHED"),
    ],
    finalStatus: "finished",
    result,
    cancellable: false,
    conversation: assistantOnlyConversation(result),
  };
}

function slowRunScript(request: FixtureRequest): FixtureScript {
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
      userEvent(request),
      assistantText(request, "Starting the slow command..."),
    ],
    finalStatus: "cancelled",
    cancellable: true,
    conversation: assistantOnlyConversation("Starting the slow command..."),
  };
}

function errorRunScript(request: FixtureRequest): FixtureScript {
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
      userEvent(request),
      assistantText(request, "Command failed"),
    ],
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
      systemEvent(request, defaultLocalTools(request)),
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
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
      userEvent(request),
      thinkingEvent(request, "Plan: inspect index.js, then ask before editing."),
      toolCallCompleted(request, callId, "shell"),
      assistantText(request, "The answer is 42."),
      taskEvent(request, "inspection-complete"),
      requestEvent(request),
    ],
    finalStatus: "finished",
    result: "The answer is 42.",
    cancellable: false,
    conversation: assistantOnlyConversation("The answer is 42."),
  };
}

function twoShellCommandsScript(request: FixtureRequest): FixtureScript {
  const call1 = generateCallId();
  const call2 = generateCallId();
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
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
      systemEvent(request, defaultLocalTools(request)),
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
            { type: "toolCall", message: { callId, name: "shell" } },
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

function spawnSubagentsScript(request: FixtureRequest): FixtureScript {
  const subagents = Object.entries(request.subagents);
  const lines: string[] = ["Spawning subagents:"];
  for (const [name, def] of subagents) {
    lines.push(`- ${name}: ${def.prompt}`);
  }
  const text = lines.join("\n");
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
      userEvent(request),
      assistantText(request, text),
    ],
    finalStatus: "finished",
    result: text,
    cancellable: false,
    conversation: assistantOnlyConversation(text),
  };
}

function listMcpToolsScript(request: FixtureRequest): FixtureScript {
  const tools = defaultLocalTools(request);
  return {
    events: [
      systemEvent(request, tools),
      userEvent(request),
      assistantText(request, `Active tools: ${tools.join(", ")}`),
    ],
    finalStatus: "finished",
    result: `Active tools: ${tools.join(", ")}`,
    cancellable: false,
    conversation: assistantOnlyConversation(`Active tools: ${tools.join(", ")}`),
  };
}

function webSearchScript(request: FixtureRequest): FixtureScript {
  const callId = generateCallId();
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
      userEvent(request),
      toolCallCompleted(request, callId, "mcp_search_provider_web_search"),
      assistantText(request, "Search complete."),
    ],
    finalStatus: "finished",
    result: "Search complete.",
    cancellable: false,
    conversation: assistantOnlyConversation("Search complete."),
  };
}

function providerFallbackScript(request: FixtureRequest): FixtureScript {
  const fallback = request.agentOptions.providers?.fallback?.[0] ?? "openrouter";
  const fallbackModel = `${fallback}:fallback-default`;
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
      userEvent(request),
      assistantText(request, "Falling back to alternate provider."),
    ],
    finalStatus: "finished",
    result: "Falling back to alternate provider.",
    cancellable: false,
    conversation: assistantOnlyConversation("Falling back to alternate provider."),
    extraRunFields: {
      model: { id: fallbackModel },
      provider: {
        requested: "unavailable",
        selected: fallback,
        fallbackReason: "unavailable-provider",
      },
    },
  };
}

function printEnvScript(request: FixtureRequest): FixtureScript {
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
      userEvent(request),
      assistantText(request, "Environment summary printed (secrets redacted with ***)."),
    ],
    finalStatus: "finished",
    result: "Environment summary printed (secrets redacted with ***).",
    cancellable: false,
    conversation: assistantOnlyConversation(
      "Environment summary printed (secrets redacted with ***).",
    ),
  };
}

function useSkillScript(request: FixtureRequest, skillName: string): FixtureScript {
  const text = `Using skill: ${skillName} (metadata only — body redacted).`;
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
      userEvent(request),
      assistantText(request, text),
    ],
    finalStatus: "finished",
    result: text,
    cancellable: false,
    conversation: assistantOnlyConversation(text),
  };
}

function contextAwareScript(request: FixtureRequest): FixtureScript {
  const text = "The project uses deterministic contract tests for the Theo SDK.";
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
      userEvent(request),
      assistantText(request, text),
    ],
    finalStatus: "finished",
    result: text,
    cancellable: false,
    conversation: assistantOnlyConversation(text),
  };
}

function defaultFinishedScript(request: FixtureRequest): FixtureScript {
  const text = "Done.";
  return {
    events: [
      systemEvent(request, defaultLocalTools(request)),
      userEvent(request),
      assistantText(request, text),
    ],
    finalStatus: "finished",
    result: text,
    cancellable: false,
    conversation: assistantOnlyConversation(text),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Secret redaction — strips obvious provider tokens from event payloads
// ─────────────────────────────────────────────────────────────────────────────

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-proj-[A-Za-z0-9_-]+/g,
  /ghp_[A-Za-z0-9_-]+/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9_-]{8,}/g,
  /fixture-search-secret/g,
];

function redactScriptSecrets(script: FixtureScript): FixtureScript {
  const events = script.events.map(redactEventSecrets);
  return { ...script, events };
}

function redactEventSecrets(event: SDKMessage): SDKMessage {
  const serialized = JSON.stringify(event);
  let redacted = serialized;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, "***");
  }
  if (redacted === serialized) return event;
  return JSON.parse(redacted) as SDKMessage;
}

/**
 * Extract a Run-level extras object (e.g. fallback provider info) when the
 * script declared one. Used by the Run impl to merge into RunResult.
 *
 * @internal
 */
export function applyExtraRunFields(
  base: RunResult,
  script: FixtureScript,
): RunResult {
  if (script.extraRunFields === undefined) return base;
  return { ...base, ...script.extraRunFields } as RunResult;
}
