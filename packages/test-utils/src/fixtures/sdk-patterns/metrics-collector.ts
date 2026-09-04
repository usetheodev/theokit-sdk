/**
 * Metrics - 140L consolidated
 * @internal
 */

export function buildMetricsCollector() {
  return { configured: true, active: true };
}

export const METRICS_COLLECTOR_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
