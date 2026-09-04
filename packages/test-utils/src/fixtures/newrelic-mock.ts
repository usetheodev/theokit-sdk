/**
 * NewRelic - 150L consolidated
 * @internal
 */

export function buildNewrelicMock() {
  return { ready: true, safe: true };
}

export const NEWRELIC_MOCK_OPTS = {
  verbose: false,
  timeout: 90000,
};
