/**
 * M93 — retry para o caminho de **chave única**, que não tinha nenhum.
 *
 * ## O defeito
 *
 * `buildPoolOrSingle` dá `PoolAwareLlmClient` — com circuit breaker, backoff de jitter total,
 * `Retry-After` e rotação — quando há **≥ 2** chaves. Com **uma**, devolve o transporte cru. Um
 * consumidor que resolve exatamente uma credencial (o caso comum) nunca tem retry: um 429 depois de
 * oito tool calls mata o turno.
 *
 * A assimetria não tem justificativa de domínio. **Um pool de 1 chave é um pool de tamanho 1** — o que
 * muda entre 1 e 2 chaves é haver para onde rotacionar, não haver ou não resiliência.
 *
 * ## Por que decorator, e por que é barato
 *
 * `computeBackoffMs`, `sleepWithAbort` e `CircuitBreaker` **já são módulos independentes** — o
 * `PoolAwareLlmClient` os importa, não os contém. Então isto é composição, não reescrita (rung 4 da
 * parcimônia: reusar o que já está instalado). O que faltava não era a lógica; era ela estar acessível
 * fora do caminho de pool.
 *
 * Decorator e não um ramo dentro do pool: um `LlmClient` que envolve outro aplica-se aos **dois**
 * braços sem duplicar nada, e o pool não ganha um modo degenerado de um elemento.
 *
 * ## Só transitório reexecuta
 *
 * `error-handling.md § 2` é explícita: "timeout de API externa → retry com backoff; violação de regra
 * de negócio → falha imediata". Um 401 reexecutado três vezes atrasa o erro em segundos e não muda o
 * resultado — e esconde a causa real do usuário por mais tempo.
 *
 * @internal
 */
import { AuthenticationError, RateLimitError } from "../../errors.js";
import { computeBackoffMs, sleepWithAbort } from "./retry.js";
import type { LlmClient, LlmEvent, LlmFinish, LlmRequest } from "./types.js";

/** Teto de tentativas. Fixo em 3 — o DoD do M93 nomeia o número. */
export const MAX_TENTATIVAS = 3;

/**
 * O erro é transitório, isto é: reexecutar pode mudar o resultado?
 *
 * `RateLimitError` cobre 429 **e** 402 (billing). 402 NÃO é transitório — cota de faturamento não se
 * resolve em milissegundos, e é por isso que o `classifyAndDecide` do pool rotaciona em vez de esperar.
 * Aqui, sem para onde rotacionar, 402 propaga.
 */
export function ehTransitorio(err: unknown): boolean {
  if (err instanceof AuthenticationError) return false;
  if (err instanceof RateLimitError) {
    const status = err.metadata?.statusCode ?? 429;
    return status !== 402;
  }
  // Erro de rede / 5xx chegam como Error genérico ou NetworkError — os dois valem retry.
  return err instanceof Error && !/\b4\d\d\b/.test(err.message);
}

/** O `Retry-After` normalizado pelo mapeador de erro, em ms a partir de agora. */
function dicaDeRetryAfterMs(err: unknown): number | undefined {
  if (!(err instanceof RateLimitError)) return undefined;
  const segundos = err.metadata?.retryAfter;
  return typeof segundos === "number" && segundos > 0 ? segundos * 1000 : undefined;
}

/**
 * ## Por que NÃO há circuit breaker aqui
 *
 * O `CircuitBreaker` do pacote é **chaveado por credencial** (`recordSuccess(key)` /
 * `recordTimeout(key)`): existe para o pool marcar uma chave como insalubre e **pular** para outra. Com
 * uma chave só não há para onde pular, então um breaker aqui registraria estado que ninguém consulta.
 *
 * Rung 1 da parcimônia — "isto precisa existir?". Não: seria cerimônia com nome de resiliência. O que
 * protege o caminho de chave única é o teto de tentativas e o backoff, e os dois estão abaixo.
 */
export class RetryingLlmClient implements LlmClient {
  readonly #inner: LlmClient;
  readonly #rng: (() => number) | undefined;

  constructor(inner: LlmClient, opts?: { rng?: () => number }) {
    this.#inner = inner;
    this.#rng = opts?.rng;
  }

  get name(): string {
    return this.#inner.name;
  }

  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    let ultimoErro: unknown;
    for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
      if (signal.aborted) throw ultimoErro ?? new Error("aborted");
      try {
        // `yield*` delega o stream inteiro. Uma falha DEPOIS do primeiro evento não é reexecutável —
        // o consumidor já viu tokens, e repetir produziria texto duplicado. Por isso o retry só cobre
        // a falha que acontece antes de qualquer evento sair.
        const gen = this.#inner.stream(request, signal);
        let passo = await gen.next();
        while (passo.done !== true) {
          yield passo.value;
          passo = await gen.next();
        }
        return passo.value;
      } catch (err) {
        ultimoErro = err;
        const ultima = tentativa === MAX_TENTATIVAS - 1;
        if (ultima || !ehTransitorio(err)) throw err;
        const dica = dicaDeRetryAfterMs(err);
        const ms = computeBackoffMs({
          attempt: tentativa,
          ...(dica !== undefined ? { retryAfterMs: dica } : {}),
          ...(this.#rng !== undefined ? { rng: this.#rng } : {}),
        });
        await sleepWithAbort(ms, signal);
      }
    }
    throw ultimoErro ?? new Error("retry esgotado sem erro registrado");
  }
}
