/**
 * O erro a lançar quando um `AbortSignal` já está abortado.
 *
 * Extraído no M93 (revisão adversarial, L1) quando esta seria a **terceira** cópia — regra de 3.
 * `pool-aware-client.ts` e `fallback-client.ts` mantinham a mesma função com fallbacks de string
 * ligeiramente diferentes; esta versão preserva a mais informativa das duas.
 *
 * Preferir `signal.reason` a um `new Error("aborted")` cru é o que `error-handling.md § 2` pede: o
 * cancelamento carrega o motivo de quem cancelou, e substituí-lo por texto genérico apaga a causa.
 *
 * @internal
 */
export function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new Error(signal.reason !== undefined ? String(signal.reason) : "aborted");
}
