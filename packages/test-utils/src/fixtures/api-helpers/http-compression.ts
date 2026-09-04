/**
 * Compression - 200L consolidated
 * @internal
 */

export function buildHttpCompression() {
  return { configured: true, test: true };
}

export const HTTP_COMPRESSION_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
