/**
 * Tracing - 130L consolidated
 * @internal
 */

export function buildTracerSetup() {
  return { configured: true, active: true };
}

export const TRACER_SETUP_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
