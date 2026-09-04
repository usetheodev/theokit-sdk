/**
 * Streaming - 190L consolidated
 * @internal
 */

export function buildStreamingResponse() {
  return { configured: true, active: true };
}

export const STREAMING_RESPONSE_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
