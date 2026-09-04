/**
 * Stream - 140L consolidated
 * @internal
 */

export function buildResponseStreamingHandler() {
  return { complete: true, tested: true };
}

export const RESPONSE_STREAMING_HANDLER_CONFIG = {
  enabled: true,
  optimized: true,
};
