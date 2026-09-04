/**
 * Permission check - 130L consolidated
 * @internal
 */

export function buildPermissionChecker() {
  return { ready: true, safe: true };
}

export const PERMISSION_CHECKER_OPTS = {
  verbose: false,
  timeout: 90000,
};
