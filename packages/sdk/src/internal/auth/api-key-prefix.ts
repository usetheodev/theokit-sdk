/**
 * "Which provider issued this key?" — the pure prefix answer.
 *
 * Lives in `auth/` and not beside the local-run helper that used to own it, because the question is
 * an auth question. The local-run path additionally refuses a provider it has no profile for; that
 * is its policy, not part of this answer, so it stays there and composes with this.
 *
 * Lives under `internal/` by FOLDER, and is PUBLIC by contract — re-exported from
 * `@theokit/sdk/auth`.
 *
 * Deliberately NOT tagged `@internal`: `tsconfig.base.json` sets `stripInternal: true`, so that tag
 * deletes the declaration from every emitted `.d.ts`. The symbol then exists at runtime and cannot
 * be imported with types — which is the exact defect this module was published to fix, reintroduced
 * one layer down by a docblock. Measured: usetheodev/theokit-sdk#283.
 */

/** Prefix → provider. Order here is irrelevant: the lookup sorts. */
const PREFIXES: Readonly<Record<string, string>> = {
  "sk-or-": "openrouter",
  "sk-ant-": "anthropic",
  "sk-": "openai",
};

/**
 * Longest first, computed once.
 *
 * The ordering IS the correctness property, so it is derived rather than written down: every
 * OpenRouter and Anthropic key also starts with `sk-`, and a shortest-match-first scan resolves
 * them to OpenAI. That failure is invisible locally — it surfaces as a remote 401 from the wrong
 * endpoint, with a message that says nothing about prefixes. The previous implementation was
 * correct only because the entries happened to be written in a workable order; appending a longer
 * prefix, or sorting the table for readability, would have broken it silently.
 */
const BY_LENGTH: ReadonlyArray<readonly [string, string]> = Object.entries(PREFIXES).sort(
  (a, b) => b[0].length - a[0].length,
);

/**
 * The provider whose key prefix matches, or `undefined` when none does.
 *
 * `undefined` means "cannot tell" and never a guess: a wrong guess here routes a real credential to
 * the wrong endpoint. Whitespace-only and empty inputs are "cannot tell" too — they are what an
 * empty prompt submits, not a key.
 */
export function providerFromApiKeyPrefix(apiKey: string | undefined): string | undefined {
  if (apiKey === undefined) return undefined;
  const key = apiKey.trim();
  if (key.length === 0) return undefined;
  for (const [prefix, provider] of BY_LENGTH) {
    if (key.startsWith(prefix)) return provider;
  }
  return undefined;
}
