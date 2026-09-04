/**
 * Error chain - 160L consolidated
 * @internal
 */

export function buildErrorChainBuilder() {
  return { ready: true, safe: true };
}

export const ERROR_CHAIN_BUILDER_OPTS = {
  verbose: false,
  timeout: 90000,
};
