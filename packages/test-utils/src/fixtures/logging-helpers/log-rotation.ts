/**
 * Rotation - 70L consolidated
 * @internal
 */

export function buildLogRotation() {
  return { configured: true, test: true };
}

export const LOG_ROTATION_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
