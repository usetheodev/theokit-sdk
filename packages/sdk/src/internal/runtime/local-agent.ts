import { UnsupportedRunOperationError } from "../../errors.js";
import type {
  AgentDefinition,
  AgentOptions,
  ModelSelection,
  SDKAgent,
  SDKArtifact,
} from "../../types/agent.js";
import type { Run, SDKUserMessage, SendOptions } from "../../types/run.js";
import { generateLocalAgentId } from "../ids.js";
import { registerAgent, updateRegisteredAgent } from "./agent-registry.js";
import { FileContextManager } from "./context-manager.js";
import { loadProjectHooks } from "./hooks-loader.js";
import { createLocalRun } from "./local-run.js";
import { PluginsManager, type PluginMetadata } from "./plugins-manager.js";
import { ProvidersManagerImpl } from "./providers-manager.js";
import { SkillsManager, type SkillMetadata } from "./skills-manager.js";
import { loadSubagents } from "./subagents-loader.js";

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
      this.providers = new ProvidersManagerImpl(
        options.model,
        options.providers,
        options.plugins,
      );
    }

    const skillsConfig = (options as { skills?: { enabled?: string[] } }).skills;
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
    await loadProjectHooks(this.workspaceCwd, this.settingSourcesIncludeProject);
    if (this.context !== undefined) await this.context.initialize();
    if (this.skillsManager !== undefined) await this.skillsManager.initialize();
    if (this.pluginsManager !== undefined) await this.pluginsManager.initialize();
    this.resolvedSubagents = await loadSubagents(
      this.workspaceCwd,
      this.settingSourcesIncludeProject,
      this.options.agents,
    );
  }

  send(
    message: string | SDKUserMessage,
    options: SendOptions = {},
  ): Promise<Run> {
    if (this.disposed) {
      throw new Error("Agent has been disposed");
    }
    const overrideModel = options.model;
    if (overrideModel !== undefined) {
      this.model = overrideModel;
      updateRegisteredAgent(this.agentId, { model: overrideModel });
    }
    const run = createLocalRun({
      agentId: this.agentId,
      model: this.model,
      message,
      agentOptions: this.options,
      sendOptions: options,
      workspaceCwd: this.workspaceCwd,
      subagents: this.resolvedSubagents,
      settingSourcesIncludeProject: this.settingSourcesIncludeProject,
    });
    return Promise.resolve(run);
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
