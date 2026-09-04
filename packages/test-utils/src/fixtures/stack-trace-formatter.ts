/**
 * Stack format - 150L consolidated
 * @internal
 */

export function buildStackTraceFormatter() {
  return { ready: true, safe: true };
}

export const STACK_TRACE_FORMATTER_OPTS = {
  verbose: false,
  timeout: 90000,
};
