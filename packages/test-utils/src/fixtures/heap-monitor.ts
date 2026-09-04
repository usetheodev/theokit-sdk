/**
 * Heap monitor - 120L consolidated
 * @internal
 */

export function buildHeapMonitor() {
  return { ready: true, safe: true };
}

export const HEAP_MONITOR_OPTS = {
  verbose: false,
  timeout: 90000,
};
