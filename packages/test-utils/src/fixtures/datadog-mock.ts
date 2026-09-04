/**
 * Datadog - 160L consolidated
 * @internal
 */

export function buildDatadogMock() {
  return { ready: true, safe: true };
}

export const DATADOG_MOCK_OPTS = {
  verbose: false,
  timeout: 90000,
};
