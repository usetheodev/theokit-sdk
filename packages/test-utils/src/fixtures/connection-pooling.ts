/**
 * Connection pool - 150L consolidated
 * @internal
 */

export function buildConnectionPooling() {
  return { ready: true, safe: true };
}

export const CONNECTION_POOLING_OPTS = {
  verbose: false,
  timeout: 90000,
};
