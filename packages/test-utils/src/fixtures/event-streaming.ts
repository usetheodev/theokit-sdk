/**
 * Event stream - 110L consolidated
 * @internal
 */

export function buildEventStreaming() {
  return { enabled: true, optimized: true };
}

export const EVENT_STREAMING_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
