import { AgentDisposedError } from "../../../errors.js";
import type { AgentOptions } from "../../../types/agent.js";
import type { ConversationStorageAdapter } from "../../../types/conversation-storage.js";
import type { Run, SDKUserMessage, SendOptions } from "../../../types/run.js";
import type { MemoryToolSpec } from "../../agent-loop/loop-types.js";
import type { PluginManager } from "../../plugins/manager.js";
import type { TelemetryHandle } from "../../telemetry/tracer.js";
import { anySignal } from "../concurrency/abort-utils.js";
import {
  resolveActiveMemorySummaryForSend,
  resolveMemoryProviderForLoop,
  resolveMemoryToolsForLoop,
  shouldUsePortMemoryPath,
} from "../memory/memory-path-selector.js";
import type { MemoryProvider } from "../memory/memory-provider.js";
import type { MemoryFact } from "../memory/memory-store.js";
import { readMemoryFacts } from "../memory/memory-store.js";
import { appendSessionMessage, getSessionMessages } from "../session/agent-session.js";
import { safeCall } from "../system-prompt/safe-call.js";
import { consumePending } from "./local-agent-invalidate.js";
import type { LocalAgentMemory } from "./local-agent-memory.js";
import { applyPreUserSendHook, wrapRunWithPostReplyHook } from "./local-agent-memory-hooks.js";
import { persistMemoryFactIfWritePrompt } from "./local-agent-runtime-extensions.js";

/**
 * Inputs for the `executeSendLocked` helper extracted from LocalAgent.sendLocked.
 * @internal
 */
export interface SendLockedInputs {
  agentId: string;
  disposed: boolean;
  invalidationPending: { reason: string; at: number } | undefined;
  clearInvalidation: () => void;
  reload: () => Promise<void>;
  applyModelOverride: (model: AgentOptions["model"]) => void;
  options: AgentOptions;
  pluginManagerCode: PluginManager;
  memoryGlue: LocalAgentMemory;
  defaultMemoryProviderForLoop: ReturnType<
    typeof import("./local-agent-memory-provider.js").createLocalAgentMemoryProvider
  >;
  workspaceCwd: string;
  storageHandle: ConversationStorageAdapter | string;
  telemetry: TelemetryHandle;
  lifecycleAbortController: AbortController;
  runPreHook: (userText: string) => Promise<void>;
  resolveSystemPromptForSend: (
    userText: string,
    options: SendOptions,
    memoryFacts: ReadonlyArray<MemoryFact>,
  ) => Promise<string | undefined>;
  assembleSystemPromptForSend: (
    userText: string,
    baseSystemPrompt: string | undefined,
    memoryFacts: ReadonlyArray<MemoryFact>,
    activeMemorySummary: string | undefined,
  ) => Promise<string | undefined>;
  // jscpd:ignore-start — type contract mirrors LocalAgent.dispatchRun signature (not knowledge duplication)
  dispatchRun: (
    message: string | SDKUserMessage,
    options: SendOptions,
    systemPrompt: string | undefined,
    memoryFacts: ReadonlyArray<MemoryFact>,
    priorMessages: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
    memoryTools: ReadonlyArray<MemoryToolSpec> | undefined,
    memoryProviderOverride?: MemoryProvider,
  ) => Promise<Run>;
  // jscpd:ignore-end
}

/**
 * Core send logic extracted from `LocalAgent.sendLocked` to reduce
 * the LocalAgent class LoC (G8 budget). All dependencies are injected
 * via the `inputs` parameter.
 *
 * @internal
 */
export async function executeSendLocked(
  inputs: SendLockedInputs,
  message: string | SDKUserMessage,
  options: SendOptions,
): Promise<Run> {
  if (inputs.disposed) throw new AgentDisposedError(inputs.agentId);
  // biome-ignore format: keep one-liner to stay under G8 LoC.
  await consumePending(inputs.agentId, inputs.invalidationPending, inputs.clearInvalidation, inputs.reload);
  inputs.applyModelOverride(options.model);
  const userText = typeof message === "string" ? message : message.text;
  if (inputs.options.onBeforeSend !== undefined) {
    await inputs.options.onBeforeSend({
      conversationId: inputs.agentId,
      previousMessageCount: getSessionMessages(inputs.agentId).length,
    });
  }
  await inputs.runPreHook(userText);

  const adaptedMessage = await applyPreUserSendHook({
    pluginManager: inputs.pluginManagerCode,
    agentId: inputs.agentId,
    options: inputs.options,
    original: message,
    userText,
    sendOptions: options,
  });

  const priorMessages = [...getSessionMessages(inputs.agentId)];
  appendSessionMessage(inputs.agentId, { role: "user", text: userText }, inputs.storageHandle);

  await persistMemoryFactIfWritePrompt(inputs.workspaceCwd, inputs.options.memory, userText);
  const memoryFacts = await readMemoryForSend(inputs.workspaceCwd, inputs.options.memory);
  const portPathActive = shouldUsePortMemoryPath();
  const legacyTools = portPathActive ? undefined : await inputs.memoryGlue.ensureTools();
  const legacySummary = portPathActive
    ? undefined
    : await inputs.memoryGlue.runActiveMemoryIfEnabled(userText, priorMessages, inputs.telemetry);
  const memoryTools = resolveMemoryToolsForLoop(legacyTools, portPathActive);
  const activeMemorySummary = resolveActiveMemorySummaryForSend(legacySummary, portPathActive);
  const effectiveMemoryProvider = resolveMemoryProviderForLoop(
    inputs.options.memoryProvider,
    inputs.defaultMemoryProviderForLoop,
    portPathActive,
  );
  const baseSystemPrompt = await inputs.resolveSystemPromptForSend(userText, options, memoryFacts);
  const assembledSystemPrompt = await inputs.assembleSystemPromptForSend(
    userText,
    baseSystemPrompt,
    memoryFacts,
    activeMemorySummary,
  );
  const composedOptions: SendOptions = {
    ...options,
    signal: anySignal([options.signal, inputs.lifecycleAbortController.signal]),
  };
  const run = await inputs.dispatchRun(
    adaptedMessage,
    composedOptions,
    assembledSystemPrompt,
    memoryFacts,
    priorMessages,
    memoryTools,
    effectiveMemoryProvider,
  );
  return wrapRunWithPostReplyHook({
    pluginManager: inputs.pluginManagerCode,
    agentId: inputs.agentId,
    options: inputs.options,
    run,
    userText,
  });
}

function readMemoryForSend(
  workspaceCwd: string,
  memoryConfig: AgentOptions["memory"],
): Promise<MemoryFact[]> {
  if (memoryConfig?.enabled !== true) return Promise.resolve([]);
  return safeCall(() => readMemoryFacts(workspaceCwd, memoryConfig), [], "memory read");
}
