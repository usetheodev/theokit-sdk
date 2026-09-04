/**
 * Exception factory - 170L consolidated
 * @internal
 */

export function buildExceptionFactory() {
  return { ready: true, safe: true };
}

export const EXCEPTION_FACTORY_OPTS = {
  verbose: false,
  timeout: 90000,
};
