/**
 * `Agent.invalidateCache` helpers extracted from LocalAgent (T3.2 / T4.3,
 * ADR D94). Keeps `local-agent.ts` under the 400-LoC gate while providing
 * the deferred-vs-applyNow semantics + EC-7 failure-path cleanup.
 *
 * @internal
 */

export interface InvalidationPending {
  reason: string;
  at: number;
}

/**
 * Run refresh + ALWAYS clear pending (EC-7).
 * @internal
 */
export async function applyDeferredInvalidation(
  agentId: string,
  pending: InvalidationPending,
  refresh: () => Promise<void>,
): Promise<void> {
  process.stderr.write(
    `[theokit-sdk] applying deferred cache invalidation (${agentId}): ${pending.reason}\n`,
  );
  try {
    await refresh();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[theokit-sdk] invalidateCache reload failed (continuing): ${msg}\n`);
  }
}

/**
 * `Agent.invalidateCache` body — handles `applyNow` short-circuit OR
 * records pending state.
 * @internal
 */
export async function invalidateCacheImpl(
  agentId: string,
  reason: string,
  options: { applyNow?: boolean },
  disposed: boolean,
  dispose: () => Promise<void>,
  setPending: (p: InvalidationPending) => void,
): Promise<void> {
  if (disposed) return;
  if (options.applyNow === true) {
    process.stderr.write(
      `[theokit-sdk] invalidateCache applyNow disposing agent (${agentId}): ${reason}\n`,
    );
    await dispose();
    return;
  }
  setPending({ reason, at: Date.now() });
}

/**
 * T4.3 — consume pending invalidation. EC-7-safe: pending cleared
 * regardless of refresh outcome.
 * @internal
 */
export async function consumePending(
  agentId: string,
  pending: InvalidationPending | undefined,
  clear: () => void,
  refresh: () => Promise<void>,
): Promise<void> {
  if (pending === undefined) return;
  clear();
  await applyDeferredInvalidation(agentId, pending, refresh);
}
