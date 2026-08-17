/**
 * Environment variable used to provide the default API key.
 *
 * @internal
 */
export const API_KEY_ENV_VAR = "THEOKIT_API_KEY";

/**
 * Read an environment variable without assuming `process` exists.
 *
 * Parts of this package legitimately reach a browser: `errors.ts` is imported by the client
 * bindings that framework consumers ship to the front end, and it in turn pulls in the redaction
 * and retry modules. `process` is a Node global — a bare `process.env` in any of them throws
 * `ReferenceError: process is not defined` while the module graph is still evaluating, before a
 * single component renders. The page goes blank with one console error that names no cause.
 *
 * `globalThis.process?.env?.[name]` degrades instead: on the server it reads the variable, and in
 * a browser it yields `undefined`, which every caller here already treats as "not set". Bundlers
 * that inline `process.env.X` at build time keep working, because they replace the expression
 * before it ever runs.
 *
 * This is the same pattern the sibling design system uses for `NODE_ENV`, for the same reason.
 *
 * @internal
 */
export function readEnv(name: string): string | undefined {
  return globalThis.process?.env?.[name];
}

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
  const fromEnv = readEnv(API_KEY_ENV_VAR);
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return undefined;
}
