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
import {
  CredentialPoolExhaustedError,
  isTransientError,
  RateLimitError,
  TheokitAgentError,
} from "../../errors.js";
import { abortError } from "./abort-error.js";
import { computeBackoffMs, sleepWithAbort } from "./retry.js";
import type { LlmClient, LlmEvent, LlmFinish, LlmRequest } from "./types.js";

/** Teto de tentativas. Fixo em 3 — o DoD do M93 nomeia o número. */
export const MAX_TENTATIVAS = 3;

/**
 * O erro é transitório, isto é: reexecutar pode mudar o resultado?
 *
 * ## Delega para `isTransientError`, e diz o que subtrai
 *
 * O SDK **já** publica `isTransientError` — documentado como "a single source of truth rather than
 * a re-derivation", e com o aviso explícito de que "It never inspects `err.message`". A primeira
 * versão desta função ignorou as duas coisas: derivou de novo, por regex sobre a mensagem
 * (`/\b4\d\d\b/`). A revisão adversarial mediu o custo — `connect ECONNREFUSED 127.0.0.1:443`
 * era classificado como NÃO transitório, porque a **porta** casa a regex. Os erros de rede para os
 * quais o retry existe eram exatamente os excluídos.
 *
 * Reinventar aqui foi violação da rung 4 da parcimônia com a peça pronta à mão. O que sobra desta
 * função são **três subtrações** do veredito do dono, cada uma com razão:
 *
 * | Subtração | Por quê |
 * |---|---|
 * | `CredentialPoolExhaustedError` | o pool já gastou o próprio orçamento de tentativas e rotação; o `nextRetryAt` está em dezenas de segundos. Reexecutar multiplicaria a espera por `MAX_TENTATIVAS` sem chance de sucesso. |
 * | `code === "circuit_open"` | o breaker existe **para** falhar rápido; envolvê-lo num retry desfaz de fora a decisão que ele acabou de tomar. |
 * | `RateLimitError` com 402 | cota de faturamento não se resolve em milissegundos — é por isso que o `classifyAndDecide` do pool rotaciona em vez de esperar. |
 *
 * As duas primeiras vieram da medição da revisão: com elas transitórias, o pool inteiro era
 * reexecutado 3×, e uma espera de 30 s virava ~90 s.
 */
export function ehTransitorio(err: unknown): boolean {
  if (!isTransientError(err)) return false;
  if (err instanceof CredentialPoolExhaustedError) return false;
  if (err instanceof TheokitAgentError && err.code === "circuit_open") return false;
  if (err instanceof RateLimitError && err.metadata?.statusCode === 402) return false;
  return true;
}

/** O `Retry-After` normalizado pelo mapeador de erro, em ms a partir de agora. */
function dicaDeRetryAfterMs(err: unknown): number | undefined {
  if (!(err instanceof RateLimitError)) return undefined;
  const segundos = err.metadata?.retryAfter;
  return typeof segundos === "number" && segundos > 0 ? segundos * 1000 : undefined;
}

/**
 * Repassa o stream interno marcando em `estado` assim que o primeiro evento sai.
 *
 * O flag precisa viver FORA do gerador porque o `catch` que decide sobre reexecução está no
 * chamador — e é essa distinção (emitiu ou não) que separa "falha reexecutável" de "turno já
 * parcialmente entregue ao consumidor".
 */
async function* consumir(
  gen: AsyncGenerator<LlmEvent, LlmFinish, void>,
  estado: { emitiu: boolean },
): AsyncGenerator<LlmEvent, LlmFinish, void> {
  let passo = await gen.next();
  while (passo.done !== true) {
    estado.emitiu = true;
    yield passo.value;
    passo = await gen.next();
  }
  return passo.value;
}

/** Vale reexecutar? Não se já emitiu, não na última tentativa, não se o erro não é transitório. */
function podeReexecutar(err: unknown, emitiu: boolean, tentativa: number): boolean {
  if (emitiu) return false;
  if (tentativa === MAX_TENTATIVAS - 1) return false;
  return ehTransitorio(err);
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

  /**
   * O cliente decorado. Público pela mesma convenção de `FaultInjectingLlmClient.inner`: os testes
   * de fiação do router afirmam `instanceof PoolAwareLlmClient` e precisam enxergar através dos
   * decorators. Sem isto, adicionar um decorator quebra testes cuja intenção continua válida — que
   * foi exatamente o que o M93 fez com 4 testes pré-existentes.
   */
  get inner(): LlmClient {
    return this.#inner;
  }

  get name(): string {
    return this.#inner.name;
  }

  /**
   * Espera o backoff da tentativa `n`, honrando o `Retry-After` do provider quando ele veio.
   *
   * Método próprio porque o `stream` é um gerador com laço aninhado, e embutir aqui a montagem
   * condicional das opções levava a complexidade cognitiva a 19 (teto do projeto: 10). O corpo do
   * `stream` fica sendo só a máquina de tentativas.
   */
  async #esperarBackoff(err: unknown, tentativa: number, signal: AbortSignal): Promise<void> {
    const dica = dicaDeRetryAfterMs(err);
    const ms = computeBackoffMs({
      attempt: tentativa,
      ...(dica !== undefined ? { retryAfterMs: dica } : {}),
      ...(this.#rng !== undefined ? { rng: this.#rng } : {}),
    });
    await sleepWithAbort(ms, signal);
  }

  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    let ultimoErro: unknown;
    for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
      if (signal.aborted) throw ultimoErro ?? abortError(signal);
      // Uma falha DEPOIS do primeiro evento NÃO é reexecutável: o consumidor já viu tokens, e
      // repetir produziria texto duplicado — e, no cenário que motiva o M93 (429 depois de oito
      // tool calls), blocos `tool_use` duplicados.
      //
      // Até a revisão adversarial do M93 este invariante estava só no comentário: o `yield` e o
      // `gen.next()` seguinte moravam ambos dentro do `try`, então uma falha no meio do stream
      // reexecutava o turno inteiro. Medido: o consumidor recebia `[tok1, tok2]` com 2 tentativas.
      // O comentário afirmava a garantia que o código não dava — a classe de apodrecimento que
      // `adr-governance.md § 5` resíduo 2 enumera.
      const estado = { emitiu: false };
      try {
        return yield* consumir(this.#inner.stream(request, signal), estado);
      } catch (err) {
        ultimoErro = err;
        if (!podeReexecutar(err, estado.emitiu, tentativa)) throw err;
        await this.#esperarBackoff(err, tentativa, signal);
      }
    }
    throw ultimoErro ?? new Error("retry esgotado sem erro registrado");
  }
}
