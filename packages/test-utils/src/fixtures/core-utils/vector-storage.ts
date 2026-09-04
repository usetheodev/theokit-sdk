/**
 * Vector storage - 140L consolidated
 * @internal
 */

export function buildVectorStorage() {
  return { configured: true, active: true };
}

export const VECTOR_STORAGE_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
