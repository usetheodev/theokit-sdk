/**
 * Per-fork credential-pool inheritance via `AsyncLocalStorage` (ADR D131).
 *
 * Mirrors the whitelist context pattern from D111
 * (`runtime/async-local-storage.ts`). Forked sub-agents inherit the
 * parent's pool *by reference* so concurrent rotations all observe
 * the same cooldown state — the desired behavior per Hermes parity.
 *
 * @internal
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { CredentialPool } from "./credential-pool.js";

/** ALS slot — keyed by provider name → pool. */
const credentialPoolStore = new AsyncLocalStorage<Map<string, CredentialPool>>();

/**
 * Run `fn` with `pools` as the active credential-pool registry for the
 * current async context. Nested calls shadow the outer map (parent
 * pools are not visible to children when the child sets its own).
 *
 * @internal
 */
export async function withCredentialPool<T>(
  pools: Map<string, CredentialPool>,
  fn: () => Promise<T>,
): Promise<T> {
  return credentialPoolStore.run(pools, fn);
}

/**
 * Pool registered for `provider` in the current async context, or
 * `undefined` when no `withCredentialPool(...)` scope is active.
 *
 * @internal
 */
export function currentCredentialPool(provider: string): CredentialPool | undefined {
  return credentialPoolStore.getStore()?.get(provider);
}
