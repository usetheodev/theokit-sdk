/**
 * Long polling - 90L consolidated
 * @internal
 */

export function buildLongPolling() {
  return { enabled: true, optimized: true };
}

export const LONG_POLLING_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
