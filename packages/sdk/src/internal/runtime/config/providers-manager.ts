import type { ModelSelection } from "../../../types/agent.js";
import type {
  PluginsSettings,
  ProviderRoutingSettings,
  ResolvedProviderRoute,
  SDKProvidersManager,
} from "../../../types/providers.js";
import { enabledPluginNames } from "../../plugins/enabled-names.js";
import type { Plugin } from "../../plugins/types.js";

/**
 * Provider routing inspector. Computes the resolved capability →
 * provider mapping from `AgentOptions.providers` + `AgentOptions.plugins` +
 * the model selection.
 *
 * @internal
 */
export class ProvidersManagerImpl implements SDKProvidersManager {
  constructor(
    private readonly model: ModelSelection | undefined,
    private readonly providers: ProviderRoutingSettings | undefined,
    private readonly plugins: PluginsSettings | readonly Plugin[] | undefined,
  ) {}

  routes(): Promise<ResolvedProviderRoute[]> {
    const resolved: ResolvedProviderRoute[] = [];
    const modelProvider = providerFromModel(this.model);
    const modelId = this.model?.id;
    const seen = new Set<string>();
    if (this.providers?.routes !== undefined) {
      for (const route of this.providers.routes) {
        const resolvedRoute = resolveRoute(route, modelProvider, modelId, this.plugins);
        if (!seen.has(route.capability)) {
          seen.add(route.capability);
          resolved.push(resolvedRoute);
        }
      }
    }
    return Promise.resolve(resolved);
  }
}

function providerFromModel(model: ModelSelection | undefined): string | undefined {
  if (model === undefined) return undefined;
  const id = model.id;
  if (id.includes(":")) return id.split(":")[0];
  return undefined;
}

function resolveRoute(
  route: { capability: string; provider: string; model?: string },
  modelProvider: string | undefined,
  modelId: string | undefined,
  plugins: PluginsSettings | readonly Plugin[] | undefined,
): ResolvedProviderRoute {
  if (route.capability === "chat" && modelProvider === route.provider) {
    const modelName = extractModelName(modelProvider, modelId, route);
    const base: ResolvedProviderRoute = {
      capability: route.capability,
      provider: route.provider,
      reason: "explicit-model-provider",
    };
    if (modelName !== undefined) base.model = modelName;
    return base;
  }
  if (enabledPluginNames(plugins).length > 0) {
    return {
      capability: route.capability,
      provider: route.provider,
      reason: "first-available-plugin-provider",
    };
  }
  return {
    capability: route.capability,
    provider: route.provider,
    reason: "explicit-route",
  };
}

/**
 * B-124 — this used to report a hard-coded literal for anthropic (and nothing
 * for every other provider) instead of the model the user actually selected.
 * When the route leaves `model` unset, the real answer is already available:
 * `modelId` is "<prefix>:<name>" (that's how `modelProvider` was derived), so
 * the name is the part after the first `:`.
 */
function extractModelName(
  prefix: string,
  modelId: string | undefined,
  route: { model?: string; provider: string },
): string | undefined {
  if (route.model !== undefined) return route.model;
  if (prefix !== route.provider || modelId === undefined) return undefined;
  const name = modelId.slice(modelId.indexOf(":") + 1);
  return name.length > 0 ? name : undefined;
}
