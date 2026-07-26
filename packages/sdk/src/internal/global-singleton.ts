/**
 * Singleton por realm, chaveado por `Symbol.for`.
 *
 * Existe porque um pacote pode ser carregado mais de uma vez no mesmo processo (duas cópias em
 * `node_modules`, ESM e CJS lado a lado, monorepo com versões distintas) — e aí `const x = new Map()`
 * a nível de módulo produz DUAS caches que não se enxergam. `Symbol.for` usa o registro global de
 * símbolos, que é do realm e não do módulo, então todas as cópias convergem para a mesma instância.
 *
 * Estava copiado verbatim em `providers/discovery.ts` e `providers/catalog-loader.ts`. Isso é
 * duplicação de CONHECIMENTO, não coincidência de forma: as duas cópias precisam concordar sobre o
 * mecanismo, e uma corrigida sem a outra produz exatamente o bug que a função existe para evitar.
 */
export function globalSingleton<T>(key: string, create: () => T): T {
  const g = globalThis as unknown as Record<symbol, T>;
  const sym = Symbol.for(key);
  if (g[sym] === undefined) g[sym] = create();
  return g[sym];
}
