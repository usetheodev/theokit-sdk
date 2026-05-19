/**
 * Barrel for the provider-as-plugin system (ADRs D105-D107).
 *
 * @internal
 */

export {
  _resetBuiltinsRegistered,
  ANTHROPIC,
  GEMINI,
  OPENAI,
  OPENROUTER,
  registerBuiltins,
} from "./builtin/index.js";
export { _resetDiscovery, discoverProviderPlugins } from "./discovery.js";
export {
  _resetProvidersForTests,
  getProviderProfile,
  listProviders,
  registerProvider,
} from "./registry.js";
export type { ApiMode, AuthType, ProviderProfile } from "./types.js";
