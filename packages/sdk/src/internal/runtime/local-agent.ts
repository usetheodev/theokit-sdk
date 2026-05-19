import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
import { resolveApiKey } from "../env.js";
import { shouldUseRealLocalRuntime } from "../fixture-mode.js";
import { generateLocalAgentId } from "../ids.js";
import { withCwdMutex } from "../memory/cwd-mutex.js";
import { PluginManager } from "../plugins/manager.js";
import { flushRegistrySaves, registerAgent, updateRegisteredAgent } from "./agent-registry.js";
import {
  appendSessionMessage,
  compactSession,
  flushSessionWrites,
  getSessionMessages,
  hydrateSession,
} from "./agent-session.js";
import { FileContextManager } from "./context-manager.js";
import { HooksExecutor } from "./hooks-executor.js";
import { consumePending, invalidateCacheImpl } from "./local-agent-invalidate.js";
import { LocalAgentMemory } from "./local-agent-memory.js";
import { extractCodePlugins } from "./local-agent-plugins.js";
import { createLocalRun } from "./local-run.js";
import {
  appendMemoryFact,
  extractMemoryFact,
  isMemoryWritePrompt,
  type MemoryFact,
  readMemoryFacts,
} from "./memory-store.js";
import { type PluginMetadata, PluginsManager } from "./plugins-manager.js";
import { runPostRunLifecycle } from "./post-run-lifecycle.js";
import { ProvidersManagerImpl } from "./providers-manager.js";
import { createRealLocalRun } from "./real-local-run.js";
import { type SkillMetadata, SkillsManager } from "./skills-manager.js";
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

  private readonly options: AgentOptions;
  private readonly workspaceCwd: string;
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

  constructor(options: AgentOptions) {
    this.agentId = options.agentId ?? generateLocalAgentId();
    this.model = options.model;
    this.options = options;
    this.workspaceCwd = resolveCwd(options.local?.cwd);
    this.settingSourcesIncludeProject = includesSetting(options, "project");
    this.settingSourcesIncludePlugins = includesSetting(options, "plugins");

    if (options.context !== undefined) {
      this.context = new FileContextManager(
        this.workspaceCwd,
        options.context,
        this.settingSourcesIncludeProject,
      );
    }

    const providerCount =
      (options.providers?.routes?.length ?? 0) + (options.plugins?.enabled?.length ?? 0);
    if (providerCount > 0 || options.providers !== undefined) {
      this.providers = new ProvidersManagerImpl(options.model, options.providers, options.plugins);
    }

    const skillsConfig = options.skills;
    if (skillsConfig !== undefined || this.settingSourcesIncludeProject) {
      this.skillsManager = new SkillsManager(
        this.workspaceCwd,
        skillsConfig?.enabled,
        this.settingSourcesIncludeProject,
      );
      const localSkills = this.skillsManager;
      this.skills = { list: () => localSkills.list() };
    }

    const pluginsConfig = options.plugins;
    if (pluginsConfig !== undefined || this.settingSourcesIncludePlugins) {
      this.pluginsManager = new PluginsManager(
        this.workspaceCwd,
        pluginsConfig?.enabled,
        this.settingSourcesIncludePlugins,
        false,
        undefined,
      );
      const localPlugins = this.pluginsManager;
      this.plugins = { list: () => localPlugins.list() };
    }

    this.hooksExecutor = new HooksExecutor(this.workspaceCwd);
    this.memoryGlue = new LocalAgentMemory(options, this.workspaceCwd, this.agentId);

    registerAgent({
      agentId: this.agentId,
      runtime: "local",
      name: options.name,
      summary: "Local contract fixture",
      model: this.model,
      createdAt: Date.now(),
      lastModified: Date.now(),
      archived: false,
      options,
      cwd: this.workspaceCwd,
      status: "finished",
    });
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
    // ADR D18: hydrate persisted session history so a resumed agent sees
    // the conversation that occurred in the previous process.
    await hydrateSession(this.agentId, this.workspaceCwd);
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
        resolve(run);
        await runPostRunLifecycle({
          run,
          userText,
          agentId: this.agentId,
          workspaceCwd: this.workspaceCwd,
          hooksExecutor: this.hooksExecutor,
          memoryGlue: this.memoryGlue,
        });
      });
    });
  }

  private async sendLocked(message: string | SDKUserMessage, options: SendOptions): Promise<Run> {
    if (this.disposed) {
      throw new Error("Agent has been disposed");
    }
    // biome-ignore format: keep one-liner to stay under G8 LoC.
    // T4.3 (ADR D94): apply deferred cache invalidation BEFORE the run.
    await consumePending(this.agentId, this.invalidationPending, () => { this.invalidationPending = undefined; }, () => this.reload());
    this.applyModelOverride(options.model);

    const userText = typeof message === "string" ? message : message.text;
    await this.runPreHook(userText);
    // Capture prior history BEFORE appending the current user message so the
    // resumed/continuation agent loop sees the conversation up to (but not
    // including) the new send.
    const priorMessages = [...getSessionMessages(this.agentId)];
    appendSessionMessage(this.agentId, { role: "user", text: userText }, this.workspaceCwd);

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
    const run = await this.dispatchRun(
      message,
      options,
      assembledSystemPrompt,
      memoryFacts,
      priorMessages,
      memoryTools,
    );
    return run;
  }

  private readMemoryForSend(): Promise<MemoryFact[]> {
    const memoryConfig = this.options.memory;
    if (memoryConfig?.enabled !== true) return Promise.resolve([]);
    // Wrap in safeCall so a corrupt memory file degrades to "no facts" instead
    // of crashing the run (edge-case review EC-4).
    return safeCall(() => readMemoryFacts(this.workspaceCwd, memoryConfig), [], "memory read");
  }

  private async maybePersistMemoryFactFromUserMessage(userText: string): Promise<void> {
    const memoryConfig = this.options.memory;
    // Top-level gate: memory must be opt-in via memory.enabled === true (EC-4).
    if (memoryConfig?.enabled !== true) return;
    if (!isMemoryWritePrompt(userText)) return;
    const fact = extractMemoryFact(userText);
    // Skip empty facts so "Remember:   " doesn't pollute the recall block (EC-3).
    if (fact.length === 0) return;
    await safeCall(
      () => appendMemoryFact(this.workspaceCwd, memoryConfig, { text: fact }),
      undefined,
      "memory write",
    );
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

  private resolveSystemPromptForSend(
    userText: string,
    options: SendOptions,
    memoryFacts: ReadonlyArray<MemoryFact>,
  ): Promise<string | undefined> {
    return resolveSystemPromptForSend(this.options.systemPrompt, options.systemPrompt, () =>
      buildSystemPromptContextHelper(this.localAssemblyInputs(), userText, memoryFacts),
    );
  }

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

  private async dispatchRun(
    message: string | SDKUserMessage,
    options: SendOptions,
    systemPrompt: string | undefined,
    memoryFacts: ReadonlyArray<MemoryFact>,
    priorMessages: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
    memoryTools: ReadonlyArray<MemoryToolSpec> | undefined,
  ): Promise<Run> {
    const apiKey = resolveApiKey(this.options.apiKey);
    if (shouldUseRealLocalRuntime(apiKey)) {
      return createRealLocalRun(
        this.buildRealRunOptions(message, options, systemPrompt, priorMessages, memoryTools),
      );
    }
    return this.createFixtureRun(message, options, systemPrompt, memoryFacts);
  }

  private buildRealRunOptions(
    message: string | SDKUserMessage,
    options: SendOptions,
    systemPrompt: string | undefined,
    priorMessages: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
    memoryTools: ReadonlyArray<MemoryToolSpec> | undefined,
  ): Parameters<typeof createRealLocalRun>[0] {
    return {
      agentId: this.agentId,
      model: this.model,
      message,
      agentOptions: this.options,
      sendOptions: options,
      workspaceCwd: this.workspaceCwd,
      hooks: this.hooksExecutor,
      pluginManager: this.pluginManagerCode,
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(options.onStep !== undefined ? { onStep: options.onStep } : {}),
      ...(options.onDelta !== undefined ? { onDelta: options.onDelta } : {}),
      ...(priorMessages.length > 0 ? { priorMessages } : {}),
      ...(memoryTools !== undefined && memoryTools.length > 0 ? { memoryTools } : {}),
    };
  }

  private async createFixtureRun(
    message: string | SDKUserMessage,
    options: SendOptions,
    systemPrompt: string | undefined,
    memoryFacts: ReadonlyArray<MemoryFact>,
  ): Promise<Run> {
    // Memory write is now handled by maybePersistMemoryFactFromUserMessage in
    // send() — no need to thread persistMemoryFact into the fixture run,
    // which would cause a double-write (edge-case review EC-2).
    const sessionMessages = getSessionMessages(this.agentId);
    const projectMcpServers = this.settingSourcesIncludeProject
      ? await readProjectMcpServers(this.workspaceCwd)
      : {};
    return createLocalRun({
      agentId: this.agentId,
      model: this.model,
      message,
      agentOptions: this.options,
      sendOptions: options,
      workspaceCwd: this.workspaceCwd,
      subagents: this.resolvedSubagents,
      settingSourcesIncludeProject: this.settingSourcesIncludeProject,
      memoryFacts: [...memoryFacts],
      sessionMessages,
      projectMcpServers,
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
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
    // Wait for any in-flight send + post-run lifecycle to release the
    // per-agent send mutex. Without this, `dispose()` could return before
    // `writeSessionSummary` finishes, leaving the caller to read a
    // partially-written `.theokit/memory/sessions/<runId>.md` file.
    await withCwdMutex(`agent-send:${this.agentId}`, () => Promise.resolve());
    // Now flush any remaining disk writes so the on-disk state matches the
    // in-memory state before the caller proceeds (ADR D17 + D18).
    await flushSessionWrites();
    await compactSession(this.agentId, this.workspaceCwd);
    await flushRegistrySaves(this.workspaceCwd);
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  // biome-ignore format: multi-line layout would push file past G8 LoC cap.
  /** T3.2 / ADR D94 — public `invalidateCache` API. @internal */
  invalidateCache = (reason: string, opts: { applyNow?: boolean } = {}): Promise<void> =>
    invalidateCacheImpl(this.agentId, reason, opts, this.disposed, () => this.dispose(), (p) => { this.invalidationPending = p; });

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

  /**
   * Public accessor for fork inheritance (T4.3 + ADR D110). Read-only by
   * contract — mutating the returned object has no effect on the agent.
   *
   * @internal
   */
  getOptionsForFork(): AgentOptions {
    return this.options;
  }

  /**
   * Goal-driven Ralph loop (T4.2, ADRs D115-D121). See {@link SDKAgent.runUntil}.
   *
   * @public
   */
  runUntil(
    goal: string,
    options?: import("../../types/goal-events.js").GoalOptions,
  ): AsyncGenerator<
    import("../../types/goal-events.js").GoalEvent,
    import("../../types/goal-events.js").GoalResult,
    void
  > {
    const agent = this;
    async function* wrap(): AsyncGenerator<
      import("../../types/goal-events.js").GoalEvent,
      import("../../types/goal-events.js").GoalResult,
      void
    > {
      const { runUntilImpl } = await import("./run-until.js");
      const { judgeCallImpl } = await import("../judge/judge-call.js");
      const { Agent } = await import("../../agent.js");
      const deps = {
        judge: async (
          ctx: import("../judge/judge-call.js").JudgeContext,
          opts?: import("../judge/judge-call.js").JudgeOptions,
        ) => judgeCallImpl(ctx, opts, { create: (o) => Agent.create(o) }),
      };
      return yield* runUntilImpl(agent, goal, options, deps);
    }
    return wrap();
  }

  /**
   * Fork a short-lived sub-agent (T4.3, ADRs D110-D114).
   *
   * @public
   */
  async fork(
    options: import("./fork-agent.js").ForkOptions,
  ): Promise<import("./fork-agent.js").ForkResult> {
    const { forkAgentImpl } = await import("./fork-agent.js");
    const { Agent } = await import("../../agent.js");
    return forkAgentImpl({ agentId: this.agentId, options: this.options }, options, {
      create: (o) => Agent.create(o),
    });
  }
}

function resolveCwd(cwd: string | string[] | undefined): string {
  if (Array.isArray(cwd)) return cwd[0] ?? process.cwd();
  return cwd ?? process.cwd();
}

function includesSetting(options: AgentOptions, source: string): boolean {
  const sources = options.local?.settingSources;
  if (sources === undefined) return false;
  return sources.includes(source as never) || sources.includes("all" as never);
}

async function readProjectMcpServers(cwd: string): Promise<Record<string, unknown>> {
  const path = join(cwd, ".theokit", "mcp.json");
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { servers?: Record<string, unknown> };
    return parsed.servers ?? {};
  } catch {
    return {};
  }
}
