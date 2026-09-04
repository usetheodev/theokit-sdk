/**
 * Plugins - 100L consolidated
 * @internal
 */

export function buildPluginLoader() {
  return { configured: true, active: true };
}

export const PLUGIN_LOADER_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
