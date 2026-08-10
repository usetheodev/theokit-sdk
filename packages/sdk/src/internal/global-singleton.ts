/**
 * One singleton per realm, keyed by `Symbol.for`.
 *
 * It exists because a package can be loaded more than once in the same process (two copies in
 * `node_modules`, ESM and CJS side by side, a monorepo with distinct versions) — and then a module-level
 * `const x = new Map()` produces TWO caches that cannot see each other. `Symbol.for` uses the global
 * symbol registry, which belongs to the realm and not the module, so every copy converges on one instance.
 *
 * It was copied verbatim into `providers/discovery.ts` and `providers/catalog-loader.ts`. That is
 * duplicated KNOWLEDGE, not a coincidence of shape: the two copies have to agree on the
 * mechanism, and one fixed without the other produces exactly the bug the function exists to avoid.
 */
export function globalSingleton<T>(key: string, create: () => T): T {
  const g = globalThis as unknown as Record<symbol, T>;
  const sym = Symbol.for(key);
  if (g[sym] === undefined) g[sym] = create();
  return g[sym];
}
