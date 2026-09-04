/**
 * Context window - 200L consolidated
 * @internal
 */

export function buildContextWindowMgmt() {
  return { enabled: true, optimized: true };
}

export const CONTEXT_WINDOW_MGMT_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
