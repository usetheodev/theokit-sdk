/**
 * Tipar a falha de socket que o `fetch` lança **antes** de existir resposta.
 *
 * ## O buraco que isto fecha
 *
 * `mapAnthropicError` / `mapOpenAIError` só entram em cena quando há uma `Response` — isto é, para
 * erros **HTTP**. Um ECONNREFUSED / ETIMEDOUT / falha de DNS estoura no `await fetch(...)`, e até o
 * M93 subia cru: `anthropic.ts` não tinha `try` nenhum, e `openai.ts` mapeava **só** Ollama e
 * relançava o resto (`throw fetchErr`).
 *
 * Isso importa porque `isTransientError` — a fonte única de verdade do SDK — devolve `false` para
 * erro estrangeiro **por contrato** ("wrap a foreign error in the appropriate SDK error first",
 * `errors.ts:429`). Com o transporte deixando o erro cru escapar, o retry do M93 estaria morto
 * exatamente para a falha mais clássica que ele existe para cobrir. O mesmo valia para o
 * `classifyAndDecide` do pool, que é anterior a este milestone.
 *
 * ## Cancelamento NÃO é falha de transporte
 *
 * `AbortError` também sai do `fetch`, e envolvê-lo num `NetworkError` (que é `isRetryable: true`)
 * faria um cancelamento explícito do usuário ser reexecutado três vezes. Ele propaga intacto.
 *
 * @internal
 */
import { NetworkError } from "../../errors.js";

/** O erro veio de um `abort()`, não de uma falha de rede? */
function ehAbort(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const nome = (err as { name?: unknown }).name;
  return nome === "AbortError" || nome === "TimeoutError";
}

/**
 * Envolve uma falha de socket num {@link NetworkError}, preservando a causa.
 *
 * Devolve o erro original — sem envolver — quando ele é um abort ou já é um erro do SDK.
 */
export function wrapTransportError(
  err: unknown,
  ctx: { providerId: string; endpoint: string },
): unknown {
  if (ehAbort(err)) return err;
  if (err instanceof NetworkError) return err;
  const detalhe = err instanceof Error ? err.message : String(err);
  return new NetworkError(`${ctx.providerId} transport failure on ${ctx.endpoint}: ${detalhe}`, {
    code: "transport_failure",
    cause: err,
  });
}
