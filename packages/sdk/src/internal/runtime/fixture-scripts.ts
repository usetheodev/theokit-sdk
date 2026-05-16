import { generateCallId } from "../ids.js";
import {
  assistantOnlyConversation,
  assistantText,
  cloudStatus,
  defaultLocalTools,
  requestEvent,
  systemEvent,
  taskEvent,
  thinkingEvent,
  toolCallCompleted,
  toolCallRunning,
  userEvent,
} from "./fixture-events.js";
import type { FixtureRequest, FixtureScript } from "./fixture-types.js";

/**
 * Concrete fixture script builders. Each function returns a fully assembled
 * `FixtureScript` for one of the prompt patterns recognised by the dispatcher
 * in `fixture-responder.ts`.
 *
 * @internal
 */

// ─────────────────────────────────────────────────────────────────────────────
// Memory: detect Remember/recall patterns
// ─────────────────────────────────────────────────────────────────────────────

import { extractMemoryFact } from "./memory-store.js";

export { extractMemoryFact, isMemoryWritePrompt } from "./memory-store.js";

export function isMemoryRecallPrompt(message: string, request: FixtureRequest): boolean {
  if (request.memoryFacts.length === 0 && request.sessionMessages.length === 0) return false;
  if (/^\s*Remember/i.test(message)) return false;
  return (
    message.toLowerCase().includes("preferred") ||
    message.includes("What answer did I ask you to remember") ||
    message.includes("editor and token") ||
    message.includes("What is my")
  );
}

export function memoryWriteScript(request: FixtureRequest): FixtureScript {
  const fact = extractMemoryFactOrMessage(request.userMessage);
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

export function memoryRecallScript(request: FixtureRequest): FixtureScript {
  const haystack = [
    ...request.memoryFacts.map((fact) => fact.text),
    ...request.sessionMessages.filter((msg) => msg.role === "user").map((msg) => msg.text),
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

/**
 * Fixture-script-only wrapper: the shared {@link extractMemoryFact} returns
 * `""` on no match, but the fixture's pre-existing semantics returned the
 * full message. Preserve that behaviour for the fixture path so existing
 * fixture contract tests stay green.
 */
function extractMemoryFactOrMessage(message: string): string {
  const fact = extractMemoryFact(message);
  return fact.length > 0 ? fact : message;
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
// Local script builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a "finished" fixture script where the assistant simply replies with
 * `text` and the conversation contains a single assistant turn. Most local
 * scripts follow this shape — keeping the helper deduplicates the repeated
 * `{events, finalStatus, result, cancellable, conversation}` literal.
 */
function finishedAssistantScript(request: FixtureRequest, text: string): FixtureScript {
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

export function returnAnswerScript(request: FixtureRequest, answer: string): FixtureScript {
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

export function buildCloudScript(request: FixtureRequest): FixtureScript {
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

export function slowRunScript(request: FixtureRequest): FixtureScript {
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

export function errorRunScript(request: FixtureRequest): FixtureScript {
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

export function returnOnlyScript(request: FixtureRequest): FixtureScript {
  const trimmed = request.userMessage.replace(/^.*Return only:\s*/i, "").trim();
  const text = trimmed.length === 0 ? "The answer is 42." : trimmed;
  return finishedAssistantScript(request, text);
}

export function shellWithApprovalScript(request: FixtureRequest): FixtureScript {
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

export function twoShellCommandsScript(request: FixtureRequest): FixtureScript {
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

export function shellExplainScript(request: FixtureRequest): FixtureScript {
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

export function spawnSubagentsScript(request: FixtureRequest): FixtureScript {
  const subagents = Object.entries(request.subagents);
  const lines: string[] = ["Spawning subagents:"];
  for (const [name, def] of subagents) {
    lines.push(`- ${name} (${def.description}): ${def.prompt}`);
  }
  return finishedAssistantScript(request, lines.join("\n"));
}

export function listMcpToolsScript(request: FixtureRequest): FixtureScript {
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

export function webSearchScript(request: FixtureRequest): FixtureScript {
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

export function providerFallbackScript(request: FixtureRequest): FixtureScript {
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

export function printEnvScript(request: FixtureRequest): FixtureScript {
  return finishedAssistantScript(
    request,
    "Environment summary printed (secrets redacted with ***).",
  );
}

export function useSkillScript(request: FixtureRequest, skillName: string): FixtureScript {
  return finishedAssistantScript(
    request,
    `Using skill: ${skillName} (metadata only — body redacted).`,
  );
}

export function contextAwareScript(request: FixtureRequest): FixtureScript {
  return finishedAssistantScript(
    request,
    "The project uses deterministic contract tests for the Theo SDK.",
  );
}

export function defaultFinishedScript(request: FixtureRequest): FixtureScript {
  return finishedAssistantScript(request, "Done.");
}
