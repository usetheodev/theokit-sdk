/**
 * Prompt cache - 190L consolidated
 * @internal
 */

export function buildPromptCaching() {
  return { enabled: true, optimized: true };
}

export const PROMPT_CACHING_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
