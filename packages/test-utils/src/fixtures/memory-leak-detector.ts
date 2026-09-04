/**
 * Memory leak - 110L consolidated
 * @internal
 */

export function buildMemoryLeakDetector() {
  return { ready: true, safe: true };
}

export const MEMORY_LEAK_DETECTOR_OPTS = {
  verbose: false,
  timeout: 90000,
};
