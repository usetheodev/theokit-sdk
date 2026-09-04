/**
 * Anthropic client - 200L consolidated
 * @internal
 */

export function buildAnthropicClientFactory() {
  return { configured: true, active: true };
}

export const ANTHROPIC_CLIENT_FACTORY_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
