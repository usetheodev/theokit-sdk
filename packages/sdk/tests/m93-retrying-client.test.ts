import { describe, expect, it } from "vitest";

import { AuthenticationError, RateLimitError } from "../src/errors.js";
import { RetryingLlmClient, ehTransitorio, MAX_TENTATIVAS } from "../src/internal/llm/retrying-client.js";
import type { LlmClient, LlmEvent, LlmFinish } from "../src/internal/llm/types.js";

/**
 * M93 T1.1 — o caminho de chave única ganha o retry que só o de duas tinha.
 *
 * `buildPoolOrSingle` dá circuit breaker, backoff e `Retry-After` quando há **≥ 2** chaves; com uma,
 * devolve o transporte cru. Um consumidor que resolve exatamente uma credencial — o caso comum — nunca
 * teve retry: um 429 depois de oito tool calls mata o turno inteiro.
 *
 * Os testes injetam um cliente falso que falha N vezes e conta tentativas. Nenhuma credencial de
 * provider é necessária — a lição que o M92 pagou para aprender, depois de eu ter declarado o oposto
 * imensurável.
 */
const clienteQueFalha = (
  erros: unknown[],
): { cliente: LlmClient; tentativas: () => number } => {
  let n = 0;
  const cliente: LlmClient = {
    name: "falso",
    // eslint-disable-next-line @typescript-eslint/require-await
    async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
      const erro = erros[n];
      n += 1;
      if (erro !== undefined) throw erro;
      return { stopReason: "stop", text: "", toolCalls: [] } as unknown as LlmFinish;
    },
  };
  return { cliente, tentativas: () => n };
};

const drenar = async (c: LlmClient): Promise<unknown> => {
  const gen = c.stream({} as never, new AbortController().signal);
  let passo = await gen.next();
  while (passo.done !== true) passo = await gen.next();
  return passo.value;
};

const rate429 = (): RateLimitError =>
  new RateLimitError("429", { metadata: { statusCode: 429 } as never });

describe("M93 — RetryingLlmClient", () => {
  it("429 e REEXECUTADO ate o teto", async () => {
    const { cliente, tentativas } = clienteQueFalha([rate429(), rate429(), rate429()]);
    const comRetry = new RetryingLlmClient(cliente, { rng: () => 0 });
    await expect(drenar(comRetry)).rejects.toBeInstanceOf(RateLimitError);
    expect(tentativas()).toBe(MAX_TENTATIVAS);
  });

  it("401 NAO e reexecutado — retry so piora erro permanente", async () => {
    const auth = new AuthenticationError("401");
    const { cliente, tentativas } = clienteQueFalha([auth, auth, auth]);
    const comRetry = new RetryingLlmClient(cliente, { rng: () => 0 });
    await expect(drenar(comRetry)).rejects.toBeInstanceOf(AuthenticationError);
    expect(tentativas()).toBe(1);
  });

  it("sucesso na SEGUNDA tentativa nao chama a terceira", async () => {
    const { cliente, tentativas } = clienteQueFalha([rate429()]);
    const comRetry = new RetryingLlmClient(cliente, { rng: () => 0 });
    await drenar(comRetry);
    expect(tentativas()).toBe(2);
  });

  it("402 (billing) NAO e transitorio — cota nao se resolve em milissegundos", () => {
    const billing = new RateLimitError("402", { metadata: { statusCode: 402 } as never });
    expect(ehTransitorio(billing)).toBe(false);
  });

  it("429 E transitorio", () => {
    expect(ehTransitorio(rate429())).toBe(true);
  });

  it("o cliente sem falha atravessa sem tentativa extra", async () => {
    const { cliente, tentativas } = clienteQueFalha([]);
    const comRetry = new RetryingLlmClient(cliente, { rng: () => 0 });
    await drenar(comRetry);
    expect(tentativas()).toBe(1);
  });

  it("o nome do cliente interno atravessa — o decorator e transparente", () => {
    const { cliente } = clienteQueFalha([]);
    expect(new RetryingLlmClient(cliente).name).toBe("falso");
  });
});
