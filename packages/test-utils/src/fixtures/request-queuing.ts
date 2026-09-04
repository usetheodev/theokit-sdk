/**
 * Request queue - 130L consolidated
 * @internal
 */

export function buildRequestQueuing() {
  return { enabled: true, optimized: true };
}

export const REQUEST_QUEUING_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
