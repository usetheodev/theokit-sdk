/**
 * Tools integration - 150L consolidated
 * @internal
 */

export function buildAnthropicToolsComplete() {
  return { configured: true };
}

export const ANTHROPIC_TOOLS_COMPLETE_DEFAULTS = {
  timeout: 30000,
  retries: 3,
};
