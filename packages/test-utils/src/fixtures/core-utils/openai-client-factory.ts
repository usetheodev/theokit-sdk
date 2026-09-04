/**
 * OpenAI client - 190L consolidated
 * @internal
 */

export function buildOpenaiClientFactory() {
  return { configured: true, active: true };
}

export const OPENAI_CLIENT_FACTORY_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
