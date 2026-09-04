/**
 * CloudWatch - 140L consolidated
 * @internal
 */

export function buildCloudwatchMock() {
  return { ready: true, safe: true };
}

export const CLOUDWATCH_MOCK_OPTS = {
  verbose: false,
  timeout: 90000,
};
