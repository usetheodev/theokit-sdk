/**
 * One singleton per realm, keyed by `Symbol.for`.
 *
 * It exists because a package can be loaded more than once in the same process (two copies in
 * `node_modules`, ESM and CJS side by side, a monorepo with distinct versions) — and then a module-level
 * `const x = new Map()` produces TWO caches that cannot see each other. `Symbol.for` uses the global
 * symbol registry, which belongs to the realm and not the module, so every copy converges on one instance.
 *
 * It WAS copied verbatim into `providers/discovery.ts` and `providers/catalog-loader.ts`; both now
 * import it, as does `providers/registry.ts`. That was duplicated KNOWLEDGE rather than a
 * coincidence of shape — the copies had to agree on the mechanism, and one fixed without the other
 * reproduced exactly the bug this function exists to avoid. The paragraph is kept in the past tense
 * because it is the REASON the helper exists, not a defect report: the previous wording described
 * the duplication as live, long after it was removed.
 */
export function globalSingleton<T>(key: string, create: () => T): T {
  const g = globalThis as unknown as Record<symbol, T>;
  const sym = Symbol.for(key);
  if (g[sym] === undefined) g[sym] = create();
  return g[sym];
}
