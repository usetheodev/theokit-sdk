/**
 * Logger - 150L consolidated
 * @internal
 */

export function buildLoggerFactory() {
  return { configured: true, active: true };
}

export const LOGGER_FACTORY_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
