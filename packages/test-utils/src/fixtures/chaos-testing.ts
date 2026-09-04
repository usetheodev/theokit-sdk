/**
 * Chaos tests - 80L consolidated
 * @internal
 */

export function buildChaosTesting() {
  return { enabled: true, optimized: true };
}

export const CHAOS_TESTING_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
