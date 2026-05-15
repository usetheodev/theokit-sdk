import type {
  PluginsSettings,
  ProviderRoutingSettings,
  ResolvedProviderRoute,
  SDKProvidersManager,
} from "../../types/providers.js";
import type { ModelSelection } from "../../types/agent.js";

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
    private readonly plugins: PluginsSettings | undefined,
  ) {}

  routes(): Promise<ResolvedProviderRoute[]> {
    const resolved: ResolvedProviderRoute[] = [];
    const modelProvider = providerFromModel(this.model);
    const seen = new Set<string>();
    if (this.providers?.routes !== undefined) {
      for (const route of this.providers.routes) {
        const resolvedRoute = resolveRoute(route, modelProvider, this.plugins);
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
  plugins: PluginsSettings | undefined,
): ResolvedProviderRoute {
  if (route.capability === "chat" && modelProvider === route.provider) {
    const modelName = extractModelName(modelProvider, route);
    const base: ResolvedProviderRoute = {
      capability: route.capability,
      provider: route.provider,
      reason: "explicit-model-provider",
    };
    if (modelName !== undefined) base.model = modelName;
    return base;
  }
  if (plugins?.enabled !== undefined && plugins.enabled.length > 0) {
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

function extractModelName(
  prefix: string,
  route: { model?: string; provider: string },
): string | undefined {
  if (route.model !== undefined) return route.model;
  // When the model id is "anthropic:claude-3-7-sonnet" and the route is chat→anthropic,
  // surface the model name from the prefix split.
  return prefix === route.provider ? defaultModelForProvider(prefix) : undefined;
}

function defaultModelForProvider(provider: string): string | undefined {
  if (provider === "anthropic") return "claude-3-7-sonnet";
  return undefined;
}
