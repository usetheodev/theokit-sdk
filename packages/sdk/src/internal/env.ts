/**
 * Environment variable used to provide the default API key.
 *
 * @internal
 */
export const API_KEY_ENV_VAR = "THEOKIT_API_KEY";

/**
 * Resolve the API key with the documented precedence:
 *
 *   1. Explicit `apiKey` argument.
 *   2. The `THEOKIT_API_KEY` environment variable.
 *
 * Returns `undefined` when neither is set.
 *
 * @internal
 */
export function resolveApiKey(explicit?: string): string | undefined {
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  const fromEnv = process.env[API_KEY_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return undefined;
}
