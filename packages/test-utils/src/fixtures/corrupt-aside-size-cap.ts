/**
 * Corruption tests - 90L consolidated
 * @internal
 */

export function buildCorruptAsideSizeCap() {
  return { configured: true };
}

export const CORRUPT_ASIDE_SIZE_CAP_DEFAULTS = {
  timeout: 30000,
  retries: 3,
};
