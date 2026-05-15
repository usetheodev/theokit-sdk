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
import { resolveApiKey } from "../env.js";
import { shouldUseRealLocalRuntime } from "../fixture-mode.js";
import { generateLocalAgentId } from "../ids.js";
import { registerAgent, updateRegisteredAgent } from "./agent-registry.js";
import { appendSessionMessage, getSessionMessages } from "./agent-session.js";
import { FileContextManager } from "./context-manager.js";
import { HooksExecutor } from "./hooks-executor.js";
import { createLocalRun } from "./local-run.js";
import {
  appendMemoryFact,
  type MemoryConfig,
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

    (this as Record<symbol, unknown>)[Symbol.asyncDispose] = () => this.dispose();
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
  }

  /** Expose the hooks executor so the agent loop can fire PreToolUse/etc. */
  hooks(): HooksExecutor {
    return this.hooksExecutor;
  }

  async send(message: string | SDKUserMessage, options: SendOptions = {}): Promise<Run> {
    if (this.disposed) {
      throw new Error("Agent has been disposed");
    }
    this.applyModelOverride(options.model);

    const userText = typeof message === "string" ? message : message.text;
    await this.runPreHook(userText);
    appendSessionMessage(this.agentId, { role: "user", text: userText });

    const memoryFacts = await this.readMemoryForSend();
    const baseSystemPrompt = await this.resolveSystemPromptForSend(userText, options, memoryFacts);
    const assembledSystemPrompt = await this.assembleSystemPromptForSend(
      userText,
      baseSystemPrompt,
      memoryFacts,
    );
    const run = await this.dispatchRun(message, options, assembledSystemPrompt, memoryFacts);
    this.attachPostRunHook(run);
    return run;
  }

  private readMemoryForSend(): Promise<MemoryFact[]> {
    const memoryConfig = this.options.memory;
    if (memoryConfig?.enabled !== true) return Promise.resolve([]);
    // Wrap in safeCall so a corrupt memory file degrades to "no facts" instead
    // of crashing the run (edge-case review EC-4).
    return safeCall(() => readMemoryFacts(this.workspaceCwd, memoryConfig), [], "memory read");
  }

  private async assembleSystemPromptForSend(
    userText: string,
    baseSystemPrompt: string | undefined,
    memoryFacts: ReadonlyArray<MemoryFact>,
  ): Promise<string | undefined> {
    const assemblyCtx = await this.buildAssemblyContext(userText, baseSystemPrompt, memoryFacts);
    return this.systemPromptPipeline.assemble(assemblyCtx);
  }

  private async buildAssemblyContext(
    userText: string,
    baseSystemPrompt: string | undefined,
    memoryFacts: ReadonlyArray<MemoryFact>,
  ): Promise<SystemPromptAssemblyContext> {
    const baseCtx = await this.buildSystemPromptContext(userText, memoryFacts);
    const assemblyCtx: SystemPromptAssemblyContext = {
      ...baseCtx,
      skillsAutoInject: this.options.skills?.autoInject ?? true,
      memoryAutoInject: this.options.memory?.autoInject ?? true,
    };
    if (baseSystemPrompt !== undefined) assemblyCtx.baseSystemPrompt = baseSystemPrompt;
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
  ): Promise<Run> {
    const apiKey = resolveApiKey(this.options.apiKey);
    if (shouldUseRealLocalRuntime(apiKey)) {
      return createRealLocalRun({
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
      });
    }
    return this.createFixtureRun(message, options, systemPrompt, memoryFacts);
  }

  private async createFixtureRun(
    message: string | SDKUserMessage,
    options: SendOptions,
    systemPrompt: string | undefined,
    memoryFacts: ReadonlyArray<MemoryFact>,
  ): Promise<Run> {
    const memoryConfig = this.options.memory as MemoryConfig | undefined;
    const sessionMessages = getSessionMessages(this.agentId);
    const projectMcpServers = this.settingSourcesIncludeProject
      ? await readProjectMcpServers(this.workspaceCwd)
      : {};
    const persistMemoryFact =
      memoryConfig?.enabled === true
        ? (fact: MemoryFact) => appendMemoryFact(this.workspaceCwd, memoryConfig, fact)
        : undefined;
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
      ...(persistMemoryFact !== undefined ? { persistMemoryFact } : {}),
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    });
  }

  private attachPostRunHook(run: Run): void {
    void run.wait().then(async (result) => {
      if (result.result !== undefined) {
        appendSessionMessage(this.agentId, { role: "assistant", text: result.result });
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

  dispose(): Promise<void> {
    this.disposed = true;
    return Promise.resolve();
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
