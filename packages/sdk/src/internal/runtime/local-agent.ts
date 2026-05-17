import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError, UnsupportedRunOperationError } from "../../errors.js";
import type {
  AgentDefinition,
  AgentOptions,
  ModelSelection,
  SDKAgent,
  SDKArtifact,
  SystemPromptContext,
} from "../../types/agent.js";
import type { Run, SDKUserMessage, SendOptions } from "../../types/run.js";
import type { MemoryToolSpec } from "../agent-loop/loop-types.js";
import { resolveApiKey } from "../env.js";
import { shouldUseRealLocalRuntime } from "../fixture-mode.js";
import { generateLocalAgentId } from "../ids.js";
import { withCwdMutex } from "../memory/cwd-mutex.js";
import { writeSessionSummary } from "../memory/session-summary-writer.js";
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
import { LocalAgentMemory } from "./local-agent-memory.js";
import { createLocalRun } from "./local-run.js";
import {
  appendMemoryFact,
  extractMemoryFact,
  isMemoryWritePrompt,
  type MemoryFact,
  readMemoryFacts,
} from "./memory-store.js";
import { type PluginMetadata, PluginsManager } from "./plugins-manager.js";
import { ProvidersManagerImpl } from "./providers-manager.js";
import { createRealLocalRun } from "./real-local-run.js";
import { type SkillMetadata, SkillsManager } from "./skills-manager.js";
import { loadSubagents } from "./subagents-loader.js";
import { SystemPromptPipeline } from "./system-prompt/pipeline.js";
import { safeCall } from "./system-prompt/safe-call.js";
import type { SystemPromptAssemblyContext } from "./system-prompt/types.js";
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
  private readonly skillsManager: SkillsManager | undefined;
  private readonly pluginsManager: PluginsManager | undefined;
  private readonly hooksExecutor: HooksExecutor;
  private readonly systemPromptPipeline: SystemPromptPipeline = SystemPromptPipeline.default();
  private readonly memoryGlue: LocalAgentMemory;

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
    this.resolvedSubagents = await loadSubagents(
      this.workspaceCwd,
      this.settingSourcesIncludeProject,
      this.options.agents,
    );
    // ADR D18: hydrate persisted session history so a resumed agent sees
    // the conversation that occurred in the previous process.
    await hydrateSession(this.agentId, this.workspaceCwd);
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
        await this.runPostRunLifecycle(run, userText);
      });
    });
  }

  private async runPostRunLifecycle(run: Run, userText: string): Promise<void> {
    let result: Awaited<ReturnType<Run["wait"]>>;
    try {
      result = await run.wait();
    } catch {
      // Caller observes failures via their own run.wait()/stream(); the
      // mutex still releases via the flushes below.
      await flushSessionWrites();
      return;
    }

    if (result.result !== undefined) {
      appendSessionMessage(
        this.agentId,
        { role: "assistant", text: result.result },
        this.workspaceCwd,
      );
    }

    // ADR D20 + EC-9: only finished runs feed the corpus="sessions" index.
    if (result.status === "finished" && result.result !== undefined) {
      try {
        await writeSessionSummary({
          cwd: this.workspaceCwd,
          runId: result.id,
          agentId: this.agentId,
          userText,
          assistantText: result.result,
          status: "finished",
          at: Date.now(),
        });
        // EC-3: trigger sync so the next memory_search({corpus:"sessions"})
        // sees the just-written summary. Fire-and-forget; the read path
        // tolerates a missed sync because IndexManager re-scans on each call.
        void this.memoryGlue.syncIfReady();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        process.stderr.write(
          `[theokit-sdk] session summary write failed (${result.id}): ${message}\n`,
        );
      }
    }

    await this.hooksExecutor.run({
      event: "postRun",
      output: {
        status: result.status,
        ...(result.result !== undefined ? { result: result.result } : {}),
      },
      agentId: this.agentId,
      runId: result.id,
    });
    await flushSessionWrites();
  }

  private async sendLocked(message: string | SDKUserMessage, options: SendOptions): Promise<Run> {
    if (this.disposed) {
      throw new Error("Agent has been disposed");
    }
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

  private async assembleSystemPromptForSend(
    userText: string,
    baseSystemPrompt: string | undefined,
    memoryFacts: ReadonlyArray<MemoryFact>,
    activeMemorySummary: string | undefined,
  ): Promise<string | undefined> {
    const assemblyCtx = await this.buildAssemblyContext(
      userText,
      baseSystemPrompt,
      memoryFacts,
      activeMemorySummary,
    );
    return this.systemPromptPipeline.assemble(assemblyCtx);
  }

  private async buildAssemblyContext(
    userText: string,
    baseSystemPrompt: string | undefined,
    memoryFacts: ReadonlyArray<MemoryFact>,
    activeMemorySummary: string | undefined,
  ): Promise<SystemPromptAssemblyContext> {
    const baseCtx = await this.buildSystemPromptContext(userText, memoryFacts);
    const assemblyCtx: SystemPromptAssemblyContext = {
      ...baseCtx,
      skillsAutoInject: this.options.skills?.autoInject ?? true,
      memoryAutoInject: this.options.memory?.autoInject ?? true,
    };
    if (baseSystemPrompt !== undefined) assemblyCtx.baseSystemPrompt = baseSystemPrompt;
    if (activeMemorySummary !== undefined && activeMemorySummary.length > 0) {
      assemblyCtx.activeMemorySummary = activeMemorySummary;
    }
    if (this.context !== undefined) {
      const internal = this.context.internalAssemblySnapshot();
      assemblyCtx.contextSnapshot = { sources: internal.sources };
      if (internal.maxTokens !== undefined) assemblyCtx.contextMaxTokens = internal.maxTokens;
    }
    return assemblyCtx;
  }

  private resolveSystemPromptForSend(
    userText: string,
    options: SendOptions,
    memoryFacts: ReadonlyArray<MemoryFact>,
  ): Promise<string | undefined> {
    return resolveSystemPromptForSend(this.options.systemPrompt, options.systemPrompt, () =>
      this.buildSystemPromptContext(userText, memoryFacts),
    );
  }

  private async buildSystemPromptContext(
    userText: string,
    memoryFacts: ReadonlyArray<MemoryFact>,
  ): Promise<SystemPromptContext> {
    const skills = this.skillsManager !== undefined ? await this.skillsManager.list() : [];
    return {
      agentId: this.agentId,
      cwd: this.workspaceCwd,
      model: this.model,
      skills: skills.map((skill) => ({ name: skill.name, description: skill.description })),
      userMessage: userText,
      memory: memoryFacts.map((fact) => ({ text: fact.text })),
    };
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
