import { ConfigurationError, UnsupportedRunOperationError } from "../../errors.js";
import type {
  AgentDefinition,
  AgentOptions,
  ModelSelection,
  SDKAgent,
  SDKArtifact,
} from "../../types/agent.js";
import type { Run, SDKUserMessage, SendOptions } from "../../types/run.js";
import type { MemoryToolSpec } from "../agent-loop/loop-types.js";
import { generateLocalAgentId } from "../ids.js";
import { withCwdMutex } from "../memory/cwd-mutex.js";
import type { PersonalityRegistry } from "../personality/registry.js";
import { PersonalityStore } from "../personality/store.js";
import type { PersonalityPreset } from "../personality/types.js";
import { PluginManager } from "../plugins/manager.js";
import { anySignal } from "./abort-utils.js";
import {
  appendSessionMessage,
  compactSession,
  flushSessionWrites,
  getSessionMessages,
  hydrateSession,
} from "./agent-session.js";
import type { FileContextManager } from "./context/context-manager.js";
import { HooksExecutor } from "./hooks-executor.js";
import { bootstrapSubmanagers, registerLocalAgent } from "./local-agent-bootstrap.js";
import { dispatchLocalRun } from "./local-agent-dispatch.js";
import { consumePending, invalidateCacheImpl } from "./local-agent-invalidate.js";
import { LocalAgentMemory } from "./local-agent-memory.js";
import { buildAgentMemory } from "./local-agent-memory-direct.js";
import { applyPreUserSendHook, wrapRunWithPostReplyHook } from "./local-agent-memory-hooks.js";
import {
  applyPersonalityOverlay,
  ensurePersonalityRegistryIfNeeded,
  localAgentUsePersonality,
  resolveActivePersonalityPreset,
} from "./local-agent-personality-extensions.js";
import { extractCodePlugins } from "./local-agent-plugins.js";
import {
  localAgentFork,
  localAgentRunUntil,
  persistMemoryFactIfWritePrompt,
} from "./local-agent-runtime-extensions.js";
import { registerRunAsTask } from "./local-agent-task-wrap.js";
import { type MemoryFact, readMemoryFacts } from "./memory-store.js";
import type { PluginMetadata, PluginsManager } from "./plugins/plugins-manager.js";
import { runPostRunLifecycle } from "./post-run-lifecycle.js";
import type { ProvidersManagerImpl } from "./providers-manager.js";
import { flushRegistrySaves, updateRegisteredAgent } from "./registry/agent-registry.js";
import { liveAgentRegistry } from "./registry/live-agent-registry.js";
import type { SkillMetadata, SkillsManager } from "./skills-manager.js";
import { loadSubagents } from "./subagents-loader.js";
import {
  assembleSystemPromptForSend as assembleSystemPromptForSendHelper,
  buildSystemPromptContext as buildSystemPromptContextHelper,
  type LocalAssemblyInputs,
} from "./system-prompt/local-assembly.js";
import { SystemPromptPipeline } from "./system-prompt/pipeline.js";
import { safeCall } from "./system-prompt/safe-call.js";
import { resolveSystemPromptForSend } from "./system-prompt.js";
import { validateToolCatalog } from "./validate-agent-options.js";

/**
 * Local SDKAgent implementation. Owns the workspace cwd plus the file-based
 * loaders (context, hooks, MCP, subagents, plugins, skills). Routes runs
 * through the in-process fixture responder.
 *
 * @internal
 */
export class LocalAgent implements SDKAgent {
  readonly agentId: string;
  model: ModelSelection | undefined;
  context?: FileContextManager;
  providers?: ProvidersManagerImpl;
  skills?: { list: () => Promise<SkillMetadata[]> };
  plugins?: { list: () => Promise<PluginMetadata[]> };
  memory?: import("../../types/memory-adapter.js").AgentMemory;

  private readonly options: AgentOptions;
  private readonly workspaceCwd: string;
  /**
   * Production-Readiness #1 (ADR D304): conversation storage routing.
   * - `undefined` → fall back to default `FileSystemConversationStorage` at
   *   `workspaceCwd` (zero-config behavior; existing apps unaffected).
   * - non-undefined → caller provided a custom adapter. The registry marker
   *   `requiresCustomStorage` is set so `Agent.resume` refuses to silently
   *   fall back to FS on the next process (EC-3, ADR D325).
   */
  private readonly conversationStorage:
    | import("../../types/conversation-storage.js").ConversationStorageAdapter
    | undefined;
  /**
   * D319: lifecycle AbortController fired on `dispose()`. Composed with the
   * caller's `SendOptions.signal` via `anySignal` so the LLM `fetch()`
   * aborts on either signal (user cancel OR dispose).
   */
  private readonly lifecycleAbortController = new AbortController();
  private readonly settingSourcesIncludeProject: boolean;
  private readonly settingSourcesIncludePlugins: boolean;
  private resolvedSubagents: Record<string, AgentDefinition> = {};
  private disposed = false;
  private invalidationPending: { reason: string; at: number } | undefined;
  private readonly skillsManager: SkillsManager | undefined;
  private readonly pluginsManager: PluginsManager | undefined;
  private readonly hooksExecutor: HooksExecutor;
  private readonly systemPromptPipeline: SystemPromptPipeline = SystemPromptPipeline.default();
  private readonly memoryGlue: LocalAgentMemory;
  /** T4.1 — PluginManager for code plugins (kind: general/model-provider/memory). @internal */
  private readonly pluginManagerCode: PluginManager = new PluginManager();
  /** Personality presets — lazy-loaded on first `usePersonality` call (ADRs D160-D164). @internal */
  private personalityRegistry: PersonalityRegistry | undefined;
  private readonly personalityStore: PersonalityStore;

  constructor(options: AgentOptions) {
    this.agentId = options.agentId ?? generateLocalAgentId();
    this.model = options.model;
    this.options = options;
    this.workspaceCwd = resolveCwd(options.local?.cwd);
    this.conversationStorage = options.conversationStorage;
    this.settingSourcesIncludeProject = includesSetting(options, "project");
    this.settingSourcesIncludePlugins = includesSetting(options, "plugins");

    const sub = bootstrapSubmanagers({
      options,
      workspaceCwd: this.workspaceCwd,
      settingSourcesIncludeProject: this.settingSourcesIncludeProject,
      settingSourcesIncludePlugins: this.settingSourcesIncludePlugins,
    });
    if (sub.context !== undefined) this.context = sub.context;
    if (sub.providers !== undefined) this.providers = sub.providers;
    this.skillsManager = sub.skillsManager;
    if (sub.skills !== undefined) this.skills = sub.skills;
    this.pluginsManager = sub.pluginsManager;
    if (sub.plugins !== undefined) this.plugins = sub.plugins;

    this.hooksExecutor = new HooksExecutor(this.workspaceCwd);
    this.memoryGlue = new LocalAgentMemory(options, this.workspaceCwd, this.agentId);
    this.personalityStore = new PersonalityStore(this.workspaceCwd);
    // ADR D141 / D142: `agent.memory.*` direct API over plugin-aggregated adapters.
    // Built unconditionally; `requireAdapters` throws ConfigurationError when called
    // without any registered memory plugin.
    this.memory = buildAgentMemory(
      this.pluginManagerCode,
      this.workspaceCwd,
      this.options.memoryContext,
    );

    registerLocalAgent({
      agentId: this.agentId,
      model: this.model,
      options,
      workspaceCwd: this.workspaceCwd,
    });
  }

  /** Resolve the storage handle for session helpers (custom adapter or cwd). */
  // biome-ignore format: keep on one line for G8 LoC budget.
  private storageHandle(): import("../../types/conversation-storage.js").ConversationStorageAdapter | string {
    return this.conversationStorage ?? this.workspaceCwd;
  }

  async initialize(): Promise<void> {
    await this.hooksExecutor.initialize(this.settingSourcesIncludeProject);
    if (this.context !== undefined) await this.context.initialize();
    if (this.skillsManager !== undefined) await this.skillsManager.initialize();
    if (this.pluginsManager !== undefined) await this.pluginsManager.initialize();
    // T4.1 (ADRs D97-D101 + EC-1): wire code plugins. extractCodePlugins
    // discriminates new Plugin[] from legacy `{ enabled }` metadata; the
    // latter returns empty so v1.2 callers continue to work.
    const codePlugins = extractCodePlugins(this.options.plugins);
    await this.pluginManagerCode.initialize(codePlugins);
    this.resolvedSubagents = await loadSubagents(
      this.workspaceCwd,
      this.settingSourcesIncludeProject,
      this.options.agents,
    );
    // ADR D18 + D304: hydrate persisted session history so a resumed agent
    // sees the conversation that occurred in the previous process. Storage
    // routes via the custom adapter when set, else default FS at cwd.
    await hydrateSession(this.agentId, this.storageHandle());
    // ADR D163 — hydrate previously-active personality slug (no-op if none).
    await this.personalityStore.hydrate(this.agentId);
  }

  /** T4.2 — expose PluginManager so agent-loop can fire pre_tool_call hooks. @internal */
  pluginManager(): PluginManager {
    return this.pluginManagerCode;
  }

  /** Expose the hooks executor so the agent loop can fire PreToolUse/etc. */
  hooks(): HooksExecutor {
    return this.hooksExecutor;
  }

  async send(message: string | SDKUserMessage, options: SendOptions = {}): Promise<Run> {
    // Per-call tools: run the same name/schema/dedupe checks as creation.
    // (Cloud agents reject per-call tools in CloudAgent.send.)
    if (options.tools !== undefined && options.tools.length > 0) {
      validateToolCatalog(options.tools);
    }
    // ADR D19 (EC-8): per-agent send mutex keyed by `agent-send:${agentId}`.
    // The lock spans the FULL run lifecycle — dispatch + run.wait() + post-run
    // assistant-turn append + session summary write + disk flush — so
    // concurrent sends to the SAME agentId cannot interleave user/assistant
    // records mid-turn AND `agent.dispose()` can never return before the
    // summary write finishes (ADR D20).
    return new Promise<Run>((resolve, reject) => {
      void withCwdMutex(`agent-send:${this.agentId}`, async () => {
        const userText = typeof message === "string" ? message : message.text;
        let run: Run;
        try {
          run = await this.sendLocked(message, options);
        } catch (err) {
          reject(err);
          return;
        }
        // T3.2: opt-in Task wrapping (ADRs D363/D374).
        // biome-ignore format: one-liner to stay under G8 LoC budget.
        if (options.task !== undefined) registerRunAsTask(run, this.agentId, options.task, userText);
        resolve(run);
        await runPostRunLifecycle({
          run,
          userText,
          agentId: this.agentId,
          workspaceCwd: this.workspaceCwd,
          storageHandle: this.storageHandle(),
          hooksExecutor: this.hooksExecutor,
          memoryGlue: this.memoryGlue,
        });
      });
    });
  }

  private async sendLocked(message: string | SDKUserMessage, options: SendOptions): Promise<Run> {
    if (this.disposed) throw new Error("Agent has been disposed");
    // biome-ignore format: keep one-liner to stay under G8 LoC.
    await consumePending(this.agentId, this.invalidationPending, () => { this.invalidationPending = undefined; }, () => this.reload());
    this.applyModelOverride(options.model);
    const userText = typeof message === "string" ? message : message.text;
    if (this.options.onBeforeSend !== undefined) {
      await this.options.onBeforeSend({
        conversationId: this.agentId,
        previousMessageCount: getSessionMessages(this.agentId).length,
      });
    }
    await this.runPreHook(userText);

    // ADR D145 / EC-A: pre_user_send memory adapter hooks. Recalled context
    // is capped at maxRecallContextBytes and injected as a <memory-context>
    // fence BEFORE the user prompt reaches the LLM.
    const adaptedMessage = await applyPreUserSendHook({
      pluginManager: this.pluginManagerCode,
      agentId: this.agentId,
      options: this.options,
      original: message,
      userText,
      sendOptions: options,
    });

    // Capture prior history BEFORE appending the current user message so the
    // resumed/continuation agent loop sees the conversation up to (but not
    // including) the new send.
    const priorMessages = [...getSessionMessages(this.agentId)];
    appendSessionMessage(this.agentId, { role: "user", text: userText }, this.storageHandle());

    // Auto-write-on-send: opt-in via the user typing "Remember: <fact>". Persist
    // BEFORE the LLM call so the new fact is durable even if the LLM call fails.
    await this.maybePersistMemoryFactFromUserMessage(userText);
    const memoryFacts = await this.readMemoryForSend();
    const memoryTools = await this.memoryGlue.ensureTools();
    const activeMemorySummary = await this.memoryGlue.runActiveMemoryIfEnabled(
      userText,
      priorMessages,
    );
    const baseSystemPrompt = await this.resolveSystemPromptForSend(userText, options, memoryFacts);
    const assembledSystemPrompt = await this.assembleSystemPromptForSend(
      userText,
      baseSystemPrompt,
      memoryFacts,
      activeMemorySummary,
    );
    // D319 — compose user signal + lifecycle signal so either source aborts
    // the in-flight LLM stream. Pass the composed signal downstream via a
    // shallow-cloned options object (does NOT mutate the caller's SendOptions).
    const composedOptions: SendOptions = {
      ...options,
      signal: anySignal([options.signal, this.lifecycleAbortController.signal]),
    };
    const run = await this.dispatchRun(
      adaptedMessage,
      composedOptions,
      assembledSystemPrompt,
      memoryFacts,
      priorMessages,
      memoryTools,
    );
    // ADR D145: wrap `wait()` so post_assistant_reply fires once after the run
    // completes. Fire-and-forget (errors → stderr) so the caller never blocks.
    return wrapRunWithPostReplyHook({
      pluginManager: this.pluginManagerCode,
      agentId: this.agentId,
      options: this.options,
      run,
      userText,
    });
  }

  private readMemoryForSend(): Promise<MemoryFact[]> {
    const memoryConfig = this.options.memory;
    if (memoryConfig?.enabled !== true) return Promise.resolve([]);
    // Wrap in safeCall so a corrupt memory file degrades to "no facts" instead
    // of crashing the run (edge-case review EC-4).
    return safeCall(() => readMemoryFacts(this.workspaceCwd, memoryConfig), [], "memory read");
  }

  // Memory write helper extracted to `local-agent-runtime-extensions.ts` for G8.
  private maybePersistMemoryFactFromUserMessage(userText: string): Promise<void> {
    return persistMemoryFactIfWritePrompt(this.workspaceCwd, this.options.memory, userText);
  }

  private localAssemblyInputs(): LocalAssemblyInputs {
    return {
      agentId: this.agentId,
      workspaceCwd: this.workspaceCwd,
      model: this.model,
      options: this.options,
      context: this.context,
      skillsManager: this.skillsManager,
      systemPromptPipeline: this.systemPromptPipeline,
    };
  }

  private assembleSystemPromptForSend(
    userText: string,
    baseSystemPrompt: string | undefined,
    memoryFacts: ReadonlyArray<MemoryFact>,
    activeMemorySummary: string | undefined,
  ): Promise<string | undefined> {
    return assembleSystemPromptForSendHelper(
      this.localAssemblyInputs(),
      userText,
      baseSystemPrompt,
      memoryFacts,
      activeMemorySummary,
    );
  }

  private async resolveSystemPromptForSend(
    userText: string,
    options: SendOptions,
    memoryFacts: ReadonlyArray<MemoryFact>,
  ): Promise<string | undefined> {
    const base = await resolveSystemPromptForSend(
      this.options.systemPrompt,
      options.systemPrompt,
      () => buildSystemPromptContextHelper(this.localAssemblyInputs(), userText, memoryFacts),
    );
    this.personalityRegistry = await ensurePersonalityRegistryIfNeeded({
      agentId: this.agentId,
      workspaceCwd: this.workspaceCwd,
      personalityStore: this.personalityStore,
      personalityRegistry: this.personalityRegistry,
    });
    return applyPersonalityOverlay(this.activePreset(), base);
  }

  /** @internal — read-only personality lookup (composes the helper, honors fork ALS). */
  // biome-ignore format: keep one-liner so the personality lookup stays under G8.
  private activePreset(): PersonalityPreset | undefined { return resolveActivePersonalityPreset({ agentId: this.agentId, personalityStore: this.personalityStore, personalityRegistry: this.personalityRegistry }); }

  private applyModelOverride(overrideModel: ModelSelection | undefined): void {
    if (overrideModel === undefined) return;
    this.model = overrideModel;
    updateRegisteredAgent(this.agentId, { model: overrideModel });
  }

  private async runPreHook(userText: string): Promise<void> {
    const preRun = await this.hooksExecutor.run({
      event: "preRun",
      input: { message: userText },
      agentId: this.agentId,
    });
    if (preRun.blocked) {
      throw new ConfigurationError(
        `preRun hook denied execution: ${preRun.reason ?? "unspecified"}`,
        { code: "hook_denied" },
      );
    }
  }

  private dispatchRun(
    message: string | SDKUserMessage,
    options: SendOptions,
    systemPrompt: string | undefined,
    memoryFacts: ReadonlyArray<MemoryFact>,
    priorMessages: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
    memoryTools: ReadonlyArray<MemoryToolSpec> | undefined,
  ): Promise<Run> {
    return dispatchLocalRun({
      inputs: {
        agentId: this.agentId,
        model: this.model,
        options: this.options,
        workspaceCwd: this.workspaceCwd,
        hooksExecutor: this.hooksExecutor,
        pluginManager: this.pluginManagerCode,
        resolvedSubagents: this.resolvedSubagents,
        settingSourcesIncludeProject: this.settingSourcesIncludeProject,
      },
      message,
      sendOptions: options,
      systemPrompt,
      memoryFacts,
      priorMessages,
      memoryTools,
      activePreset: this.activePreset(),
    });
  }

  close(): void {
    this.disposed = true;
  }

  async reload(): Promise<void> {
    if (this.context !== undefined) await this.context.refresh();
    if (this.skillsManager !== undefined) await this.skillsManager.refresh();
    if (this.pluginsManager !== undefined) await this.pluginsManager.refresh();
    this.resolvedSubagents = await loadSubagents(
      this.workspaceCwd,
      this.settingSourcesIncludeProject,
      this.options.agents,
    );
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    // Evict from live cache so the next Agent.getOrCreate(id) builds fresh.
    liveAgentRegistry.forget(this.agentId);
    // D319: fire the lifecycle abort so any in-flight LLM `fetch()` cancels.
    // `abort()` is idempotent — safe to call even when already aborted.
    this.lifecycleAbortController.abort();
    // Wait for any in-flight send + post-run lifecycle to release the
    // per-agent send mutex. Without this, `dispose()` could return before
    // `writeSessionSummary` finishes, leaving the caller to read a
    // partially-written `.theokit/memory/sessions/<runId>.md` file.
    await withCwdMutex(`agent-send:${this.agentId}`, () => Promise.resolve());
    // Now flush any remaining disk writes so the on-disk state matches the
    // in-memory state before the caller proceeds (ADR D17 + D18).
    await flushSessionWrites();
    await compactSession(this.agentId, this.storageHandle());
    await flushRegistrySaves(this.workspaceCwd);
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  // biome-ignore format: multi-line layout would push file past G8 LoC cap.
  /** T3.2 / ADR D94 — public `invalidateCache` API. @internal */
  invalidateCache = (reason: string, opts: { applyNow?: boolean } = {}): Promise<void> =>
    invalidateCacheImpl(this.agentId, reason, opts, this.disposed, () => this.dispose(), (p) => { this.invalidationPending = p; });

  /**
   * Activate a personality preset (Hermes #26, ADRs D160-D164).
   *
   * Reserved names `none`, `default`, `neutral` clear the active preset.
   *
   * - `opts.save: true` → persist across process restarts (delete on clear,
   *   never write null — EC-B).
   * - `opts.reset: true` → also clear session history (preserves by default).
   *
   * Always invalidates the prompt cache (D94 deferred default).
   *
   * @public
   */
  usePersonality(
    name: string,
    opts?: { save?: boolean; reset?: boolean },
  ): Promise<PersonalityPreset | null> {
    return localAgentUsePersonality({
      agentId: this.agentId,
      workspaceCwd: this.workspaceCwd,
      storageHandle: this.storageHandle(),
      disposed: this.disposed,
      personalityStore: this.personalityStore,
      personalityRegistry: this.personalityRegistry,
      invalidateCache: (reason) => this.invalidateCache(reason),
      onRegistryLoaded: (reg) => {
        this.personalityRegistry = reg;
      },
      name,
      ...(opts !== undefined ? { opts } : {}),
    });
  }

  listArtifacts(): Promise<SDKArtifact[]> {
    return Promise.resolve([]);
  }

  downloadArtifact(_path: string): Promise<Buffer> {
    return Promise.reject(
      new UnsupportedRunOperationError(
        "Artifacts are not supported for local agents",
        "downloadArtifact",
      ),
    );
  }

  // biome-ignore format: G8 budget — both methods delegate to `local-agent-runtime-extensions.ts`; signatures kept as 1-line each.
  runUntil(goal: string, options?: import("../../types/goal-events.js").GoalOptions): import("../../types/goal-events.js").RunUntilIterator { return localAgentRunUntil(this, goal, options); }
  // biome-ignore format: G8 budget — see runUntil comment above.
  fork(options: import("./fork-agent.js").ForkOptions): Promise<import("./fork-agent.js").ForkResult> { return localAgentFork({ agentId: this.agentId, options: this.options, personalitySlugSnapshot: this.personalityStore.active(this.agentId) }, options); }
}

function resolveCwd(cwd: string | string[] | undefined): string {
  return (Array.isArray(cwd) ? cwd[0] : cwd) ?? process.cwd();
}

function includesSetting(options: AgentOptions, source: string): boolean {
  const sources = options.local?.settingSources;
  return (
    sources !== undefined && (sources.includes(source as never) || sources.includes("all" as never))
  );
}
