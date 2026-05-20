/**
 * `LocalAgent` constructor bootstrap helpers (extracted for G8 ≤400 LoC).
 *
 * Each helper builds one optional submanager from `AgentOptions` and
 * the resolved workspace cwd. The constructor itself stays focused on
 * the agentId / model wiring; submanager bootstrap is delegated here.
 *
 * @internal
 */

import type { AgentOptions } from "../../types/agent.js";
import { FileContextManager } from "./context-manager.js";
import { type PluginMetadata, PluginsManager } from "./plugins-manager.js";
import { ProvidersManagerImpl } from "./providers-manager.js";
import { type SkillMetadata, SkillsManager } from "./skills-manager.js";

export interface BootstrappedSubmanagers {
  context?: FileContextManager;
  providers?: ProvidersManagerImpl;
  skillsManager?: SkillsManager;
  skills?: { list: () => Promise<SkillMetadata[]> };
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
    (args.options.providers?.routes?.length ?? 0) + (args.options.plugins?.enabled?.length ?? 0);
  if (providerCount > 0 || args.options.providers !== undefined) {
    out.providers = new ProvidersManagerImpl(
      args.options.model,
      args.options.providers,
      args.options.plugins,
    );
  }
  if (args.options.skills !== undefined || args.settingSourcesIncludeProject) {
    out.skillsManager = new SkillsManager(
      args.workspaceCwd,
      args.options.skills?.enabled,
      args.settingSourcesIncludeProject,
    );
    const localSkills = out.skillsManager;
    out.skills = { list: () => localSkills.list() };
  }
  if (args.options.plugins !== undefined || args.settingSourcesIncludePlugins) {
    out.pluginsManager = new PluginsManager(
      args.workspaceCwd,
      args.options.plugins?.enabled,
      args.settingSourcesIncludePlugins,
      false,
      undefined,
    );
    const localPlugins = out.pluginsManager;
    out.plugins = { list: () => localPlugins.list() };
  }
  return out;
}
