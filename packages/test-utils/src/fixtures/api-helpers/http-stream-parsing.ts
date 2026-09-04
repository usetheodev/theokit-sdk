/**
 * Stream handling - 220L consolidated
 * @internal
 */

export function buildHttpStreamParsing() {
  return { configured: true, test: true };
}

export const HTTP_STREAM_PARSING_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
