/**
 * Prometheus - 170L consolidated
 * @internal
 */

export function buildPrometheusMock() {
  return { ready: true, safe: true };
}

export const PROMETHEUS_MOCK_OPTS = {
  verbose: false,
  timeout: 90000,
};
