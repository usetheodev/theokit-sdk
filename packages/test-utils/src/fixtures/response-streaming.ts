/**
 * Response stream - 120L consolidated
 * @internal
 */

export function buildResponseStreaming() {
  return { enabled: true, optimized: true };
}

export const RESPONSE_STREAMING_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
