/**
 * Response parse - 250L consolidated
 * @internal
 */

export function buildResponseParsing() {
  return { configured: true, active: true };
}

export const RESPONSE_PARSING_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
