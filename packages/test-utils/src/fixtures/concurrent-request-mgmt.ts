/**
 * Concurrent reqs - 140L consolidated
 * @internal
 */

export function buildConcurrentRequestMgmt() {
  return { enabled: true, optimized: true };
}

export const CONCURRENT_REQUEST_MGMT_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
