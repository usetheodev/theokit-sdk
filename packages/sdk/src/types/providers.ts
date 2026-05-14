/**
 * Capability slot a provider can fulfill.
 *
 * @public
 */
export type ProviderCapability = "chat" | "web_search" | "image" | "embedding";

/**
 * A single user-declared routing rule. Maps a capability to a provider, and
 * optionally pins a specific model.
 *
 * @public
 */
export interface ProviderRoute {
  capability: ProviderCapability;
  provider: string;
  model?: string;
}

/**
 * Provider routing configuration accepted by `Agent.create()` via
 * {@link AgentOptions.providers}.
 *
 * @public
 */
export interface ProviderRoutingSettings {
  /** Explicit `{ capability → provider }` map. First match wins per capability. */
  routes: ProviderRoute[];
  /** Provider names to try in order when a route has no provider available. */
  fallback?: string[];
}

/**
 * Plugins configuration accepted by `Agent.create()` via
 * {@link AgentOptions.plugins}.
 *
 * @public
 */
export interface PluginsSettings {
  /** Plugin names to enable. Plugin discovery is plugin-provider specific. */
  enabled?: string[];
}

/**
 * Resolved routing decision returned by `agent.providers.routes()`. Public and
 * secret-free by design — safe to log.
 *
 * @public
 */
export interface ResolvedProviderRoute {
  capability: string;
  provider: string;
  model?: string;
  /** Why the runtime picked this provider (e.g. `"explicit-model-provider"`). */
  reason: string;
}

/**
 * Public providers manager handle exposed as `agent.providers`.
 *
 * @public
 */
export interface SDKProvidersManager {
  /** Inspect which provider serves each capability for this agent. */
  routes(): Promise<ResolvedProviderRoute[]>;
}

/**
 * Provider catalog entry returned by `Theokit.providers.list()`.
 *
 * @public
 */
export interface SDKProvider {
  name: string;
  displayName: string;
  capabilities: string[];
  isAvailable: boolean;
  /** JSON Schema describing the env vars / fields needed to enable this provider. */
  setupSchema: object;
}
