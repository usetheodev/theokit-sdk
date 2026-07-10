/**
 * `LocalAgent` constructor bootstrap helpers (extracted for G8 ≤400 LoC).
 *
 * Each helper builds one optional submanager from `AgentOptions` and
 * the resolved workspace cwd. The constructor itself stays focused on
 * the agentId / model wiring; submanager bootstrap is delegated here.
 *
 * @internal
 */

import type { AgentOptions, ModelSelection } from "../../../types/agent.js";
import { asPluginsSettings, enabledPluginNames } from "../../plugins/enabled-names.js";
import { ProvidersManagerImpl } from "../config/providers-manager.js";
import { FileContextManager } from "../context/context-manager.js";
import { normalizeModel } from "../model-selection.js";
import { type PluginMetadata, PluginsManager } from "../plugins/plugins-manager.js";
import { registerAgent } from "../registry/agent-registry.js";
import { type SkillsHandle, SkillsManager } from "../skills/skills-manager.js";

export function registerLocalAgent(args: {
  agentId: string;
  model: ModelSelection | undefined;
  options: AgentOptions;
  workspaceCwd: string;
}): void {
  registerAgent({
    agentId: args.agentId,
    runtime: "local",
    name: args.options.name,
    summary: "Local contract fixture",
    model: args.model,
    createdAt: Date.now(),
    lastModified: Date.now(),
    archived: false,
    options: args.options,
    cwd: args.workspaceCwd,
    status: "finished",
    ...(args.options.conversationStorage !== undefined ? { requiresCustomStorage: true } : {}),
  });
}

export interface BootstrappedSubmanagers {
  context?: FileContextManager;
  providers?: ProvidersManagerImpl;
  skillsManager?: SkillsManager;
  skills?: SkillsHandle;
  pluginsManager?: PluginsManager;
  plugins?: { list: () => Promise<PluginMetadata[]> };
}

export function bootstrapSubmanagers(args: {
  options: AgentOptions;
  workspaceCwd: string;
  settingSourcesIncludeProject: boolean;
  settingSourcesIncludePlugins: boolean;
}): BootstrappedSubmanagers {
  const out: BootstrappedSubmanagers = {};
  if (args.options.context !== undefined) {
    out.context = new FileContextManager(
      args.workspaceCwd,
      args.options.context,
      args.settingSourcesIncludeProject,
    );
  }
  const providerCount =
    (args.options.providers?.routes?.length ?? 0) + enabledPluginNames(args.options.plugins).length;
  if (providerCount > 0 || args.options.providers !== undefined) {
    out.providers = new ProvidersManagerImpl(
      normalizeModel(args.options.model),
      args.options.providers,
      args.options.plugins,
    );
  }
  if (args.options.skills !== undefined || args.settingSourcesIncludeProject) {
    out.skillsManager = new SkillsManager(
      args.workspaceCwd,
      args.options.skills?.enabled,
      args.settingSourcesIncludeProject,
      // M22 — custom skills directory + inline (code-defined) skills.
      args.options.skills?.skillsDir,
      args.options.skills?.inline,
    );
    const localSkills = out.skillsManager;
    out.skills = {
      // Project to the public shape (name + description only). Inline skills carry
      // their body + references on the object; `list()` must never leak them —
      // the body is reachable exclusively through `get()`.
      list: async () =>
        (await localSkills.list()).map((s) => ({ name: s.name, description: s.description })),
      get: (name) => localSkills.get(name),
    };
  }
  if (args.options.plugins !== undefined || args.settingSourcesIncludePlugins) {
    out.pluginsManager = new PluginsManager(
      args.workspaceCwd,
      // The array (code-`Plugin`) form has no named-enable list; `undefined`
      // here preserves "no filter / load all file-discovered plugins".
      asPluginsSettings(args.options.plugins)?.enabled,
      args.settingSourcesIncludePlugins,
      false,
      undefined,
    );
    const localPlugins = out.pluginsManager;
    out.plugins = { list: () => localPlugins.list() };
  }
  return out;
}
