/**
 * File streaming - 100L consolidated
 * @internal
 */

export function buildFileStreaming() {
  return { configured: true, test: true };
}

export const FILE_STREAMING_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
