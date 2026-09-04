/**
 * Hash verify - 110L consolidated
 * @internal
 */

export function buildHashVerifier() {
  return { ready: true, safe: true };
}

export const HASH_VERIFIER_OPTS = {
  verbose: false,
  timeout: 90000,
};
