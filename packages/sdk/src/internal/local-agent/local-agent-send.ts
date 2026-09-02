import { AgentDisposedError, ConfigurationError } from "../../errors.js";
import type { AgentOptions, ModelSelection } from "../../types/agent.js";
import type { Run, SDKUserMessage, SendOptions } from "../../types/run.js";
import type { MemoryToolSpec } from "../agent-loop/types.js";
import { anySignal } from "../concurrency/abort-utils.js";
import { diagFailure } from "../diagnostics.js";
import { emitRunEvent } from "../emit-run-event.js";
import type { PluginManager } from "../plugins/manager.js";
import {
  type CompletionCheckDeps,
  wrapRunWithCompletionCheck,
} from "../runtime/lifecycle/wrap-completion-check-run.js";
import {
  resolveActiveMemorySummaryForSend,
  resolveMemoryProviderForLoop,
  resolveMemoryToolsForLoop,
  shouldUsePortMemoryPath,
} from "../runtime/memory-glue/memory-path-selector.js";
import type { MemoryProvider } from "../runtime/memory-glue/memory-provider.js";
import type { MemoryFact } from "../runtime/memory-glue/memory-store.js";
import { readMemoryFacts } from "../runtime/memory-glue/memory-store.js";
import { selectFactsForInjection } from "../runtime/memory-glue/select-facts.js";
import { normalizeModel } from "../runtime/model-selection.js";
import { runInputProcessors } from "../runtime/processors/run-processors.js";
import { createTripwireRun } from "../runtime/processors/tripwire-run.js";
import { wrapRunWithOutputProcessors } from "../runtime/processors/wrap-output-run.js";
import { safeCall } from "../runtime/system-prompt/safe-call.js";
import { appendSessionMessage, getSessionMessages } from "../session/index.js";
import type { TelemetryHandle } from "../telemetry/tracer.js";
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
  // SE8 — receives an already-NORMALIZED ModelSelection (the string shorthand is
  // normalized at the send boundary), decoupled from the public AgentOptions type.
  applyModelOverride: (model: ModelSelection | undefined) => void;
  options: AgentOptions;
  pluginManagerCode: PluginManager;
  memoryGlue: LocalAgentMemory;
  defaultMemoryProviderForLoop: ReturnType<
    typeof import("./local-agent-memory-provider.js").createLocalAgentMemoryProvider
  >;
  workspaceCwd: string;
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
    contextPaths: readonly string[] | undefined,
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
 * SE24 — run the input guardrail processors on the raw user text. Returns a
 * terminal `tripwireRun` when a processor blocked, else the (possibly rewritten)
 * `userText` + `effectiveMessage` to feed the rest of the send.
 */
async function applyInputProcessors(
  inputs: SendLockedInputs,
  message: string | SDKUserMessage,
  rawUserText: string,
  options: SendOptions,
  sendModel: ModelSelection | undefined,
): Promise<{ tripwireRun: Run } | { userText: string; effectiveMessage: string | SDKUserMessage }> {
  const processors = inputs.options.inputProcessors;
  if (processors === undefined || processors.length === 0) {
    return { userText: rawUserText, effectiveMessage: message };
  }
  const res = await runInputProcessors(processors, rawUserText, inputs.agentId);
  if (res.kind === "tripwire") {
    emitRunEvent(options.onRunEvent, {
      type: "tripwire",
      reason: res.tripwire.reason,
      processorId: res.tripwire.processorId,
    });
    return {
      tripwireRun: createTripwireRun({
        agentId: inputs.agentId,
        tripwire: res.tripwire,
        model: sendModel,
      }),
    };
  }
  const effectiveMessage =
    typeof message === "string" ? res.value : { ...message, text: res.value };
  return { userText: res.value, effectiveMessage };
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
  // SE8 — normalize a bare-string send-model override to `{ id }`.
  const sendModel = normalizeModel(options.model);
  inputs.applyModelOverride(sendModel);
  const rawUserText = typeof message === "string" ? message : message.text;

  // SE24 — input guardrail processors run FIRST, before any side effect; a
  // `block` short-circuits to a tripwire run, a `rewrite` flows downstream.
  const gated = await applyInputProcessors(inputs, message, rawUserText, options, sendModel);
  if ("tripwireRun" in gated) return gated.tripwireRun;
  const { userText, effectiveMessage } = gated;

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
    original: effectiveMessage,
    userText,
    sendOptions: options,
  });

  const priorMessages = [...getSessionMessages(inputs.agentId)];
  appendSessionMessage(inputs.agentId, { role: "user", text: userText });

  // Where memory lives is `memory.directory`'s answer and nobody else's. It used to be
  // `local.sessionDir`'s — the option that names the TRANSCRIPT home — so one option answered two
  // questions and only the writer heard the second answer (#463).
  await persistMemoryFactIfWritePrompt(inputs.workspaceCwd, inputs.options.memory, userText);
  const memoryFacts = await readMemoryForSend(inputs.workspaceCwd, inputs.options.memory, userText);
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
    options.contextPaths,
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
  // SE24 — output processors wrap INNER (they redact/block the model text) so the
  // post_assistant_reply memory hook observes the FINAL (processed) reply.
  const outputProcessors = inputs.options.outputProcessors;
  const processedRun =
    outputProcessors !== undefined && outputProcessors.length > 0
      ? wrapRunWithOutputProcessors({
          run,
          processors: outputProcessors,
          agentId: inputs.agentId,
          onRunEvent: options.onRunEvent,
        })
      : run;
  const hookedRun = wrapRunWithPostReplyHook({
    pluginManager: inputs.pluginManagerCode,
    agentId: inputs.agentId,
    options: inputs.options,
    run: processedRun,
    userText,
  });
  // SE34 — outermost wrap: judge the FINAL reply against the per-send completion
  // criterion (opt-in). Absent `completionCheck` ⇒ returns `hookedRun` unchanged.
  return wrapRunWithCompletionCheck({
    run: hookedRun,
    completionCheck: options.completionCheck,
    onRunEvent: options.onRunEvent,
    deps: buildCompletionCheckDeps(),
  });
}

/** Resolve the LLM-judge dep from the DI registry (mirrors runUntil's judge wiring). */
function buildCompletionCheckDeps(): CompletionCheckDeps {
  return {
    judge: async (ctx, opts) => {
      const { judgeCallImpl } = await import("../judge/judge-call.js");
      const { getAgentFacade } = await import("../runtime/registry/agent-factory-registry.js");
      return judgeCallImpl(ctx, opts, { create: getAgentFacade().create });
    },
  };
}

/**
 * Configurations already reported, so the refusal is said once rather than on every turn (#474).
 *
 * Per PROCESS and keyed by the configuration itself, not per agent: two agents built from the same
 * bad `directory` would otherwise each shout the same sentence, and the second one tells the reader
 * nothing the first did not. The set's size is the number of DISTINCT misconfigurations a process
 * holds, which is one in every case anybody has, and it never grows with turns.
 *
 * A warning that arrives every turn is a warning somebody turns off — the criterion already applied
 * to the near-miss diagnostic in #462.
 */
const reportedRefusedDirectories = new Set<string>();

function reportRefusedMemoryDirectoryOnce(
  workspaceCwd: string,
  directory: string | undefined,
  message: string,
): void {
  const key = `${workspaceCwd}\u0000${directory ?? ""}`;
  if (reportedRefusedDirectories.has(key)) return;
  reportedRefusedDirectories.add(key);
  diagFailure(
    `[theokit-sdk] memory is enabled but its directory was refused, so recall is empty on every ` +
      `turn and nothing is stored: ${message}`,
  );
}

function readMemoryForSend(
  workspaceCwd: string,
  memoryConfig: AgentOptions["memory"],
  query?: string,
): Promise<MemoryFact[]> {
  if (memoryConfig?.enabled !== true) return Promise.resolve([]);
  // Rank and cut before the facts reach the prompt. Without the cut the injected block tracked
  // the store (r = 0.958 across 99 real stores, past the session budget at 16 facts); without
  // the QUERY the cut was recency-only, and a live 25-fact run showed the answering fact
  // dropped for being old rather than irrelevant. Both halves are needed: one bounds the cost,
  // the other decides what survives.
  return safeCall(
    async () => {
      try {
        return selectFactsForInjection(await readMemoryFacts(workspaceCwd, memoryConfig), {
          ...(query === undefined ? {} : { query }),
        });
      } catch (cause) {
        // A REFUSED CONFIGURATION is not a read that went wrong; it is a read that will never go
        // right (#474). `safeCall` is correct for the case it was added for — a corrupt memory file
        // must not abort the turn (EC-4) — and it reports on `diag`, which the host may never read.
        // For a transient failure that is the right trade. A `ConfigurationError` from the resolver
        // repeats on EVERY turn, forever, and is fixable in one line by the person being kept in
        // the dark, so it goes on the channel a failure cannot be dropped from.
        //
        // The narrowing is DEFENSIVE, not load-bearing, and saying so is the point: today
        // `resolveMemoryRoot` is the only thing under `readMemoryFacts` that throws — both readers
        // swallow their own I/O errors and return `[]` (`markdown-store.ts:139-163`), so no test
        // can distinguish this line from `catch (cause)`. It stays because the message below is a
        // claim about CONFIGURATION; a future throw of another kind would inherit a sentence that
        // is false about it, on the one channel a host cannot silence.
        if (!(cause instanceof ConfigurationError)) throw cause;
        reportRefusedMemoryDirectoryOnce(workspaceCwd, memoryConfig?.directory, cause.message);
        return [];
      }
    },
    [],
    "memory read",
  );
}
