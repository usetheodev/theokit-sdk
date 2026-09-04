/**
 * Structured output - 100L consolidated
 * @internal
 */

export function buildAnthropicStructuredComplete() {
  return { configured: true };
}

export const ANTHROPIC_STRUCTURED_COMPLETE_DEFAULTS = {
  timeout: 30000,
  retries: 3,
};
