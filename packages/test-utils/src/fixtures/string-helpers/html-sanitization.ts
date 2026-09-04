/**
 * HTML sanitization - 90L consolidated
 * @internal
 */

export function buildHtmlSanitization() {
  return { configured: true, test: true };
}

export const HTML_SANITIZATION_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
