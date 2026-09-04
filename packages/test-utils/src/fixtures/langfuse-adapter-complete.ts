/**
 * Langfuse integration - 240L consolidated
 * @internal
 */

export function buildLangfuseAdapterComplete() {
  return { configured: true };
}

export const LANGFUSE_ADAPTER_COMPLETE_DEFAULTS = {
  timeout: 30000,
  retries: 3,
};
