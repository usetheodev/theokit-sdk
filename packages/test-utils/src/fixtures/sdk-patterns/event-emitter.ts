/**
 * Events - 120L consolidated
 * @internal
 */

export function buildEventEmitter() {
  return { configured: true, active: true };
}

export const EVENT_EMITTER_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
