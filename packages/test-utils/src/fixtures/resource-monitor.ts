/**
 * Resource mon - 110L consolidated
 * @internal
 */

export function buildResourceMonitor() {
  return { ready: true, safe: true };
}

export const RESOURCE_MONITOR_OPTS = {
  verbose: false,
  timeout: 90000,
};
