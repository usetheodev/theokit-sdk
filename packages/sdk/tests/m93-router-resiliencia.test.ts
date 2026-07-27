import { describe, expect, it } from "vitest";

import { RetryingLlmClient } from "../src/internal/llm/retrying-client.js";
import { resolveProviderChain } from "../src/internal/llm/router.js";

/**
 * M93 T1.2 — a assimetria entre 1 e 2 chaves some.
 *
 * `buildPoolOrSingle` dava `PoolAwareLlmClient` — circuit breaker, backoff, `Retry-After`, rotação —
 * quando `poolKeys.length >= 2`, e o transporte **cru** com uma chave. O agent-builder resolve
 * exatamente uma credencial (`resolveCredential`), então caía **sempre** no braço sem resiliência.
 *
 * Um pool de 1 chave é um pool de tamanho 1: o que muda entre 1 e 2 é haver para onde rotacionar, não
 * haver ou não retry.
 */
/**
 * O router envolve cada cliente com o decorator de fault-injection (`maybeWrapWithFaultInjection`,
 * `router.ts:74`), então `chain[0]` não é o `RetryingLlmClient` diretamente — ele está por dentro.
 * Descer a cadeia de decoradores é o que o teste precisa fazer para medir o invariante real.
 */
const temRetry = (c: unknown): boolean => {
  let atual = c;
  for (let i = 0; i < 5 && atual !== undefined && atual !== null; i++) {
    if (atual instanceof RetryingLlmClient) return true;
    atual = (atual as { inner?: unknown; ["#inner"]?: unknown }).inner;
  }
  return false;
};

describe("M93 — os dois braços do router têm retry", () => {
  it("o braco de UMA chave devolve um cliente com retry", () => {
    const chain = resolveProviderChain({ primary: "openai", apiKeys: { openai: ["k1"] } } as never);
    expect(chain.length).toBeGreaterThan(0);
    expect(temRetry(chain[0])).toBe(true);
  });

  it("o braco de DUAS chaves tambem — a assimetria some", () => {
    const chain = resolveProviderChain({
      primary: "openai",
      apiKeys: { openai: ["k1", "k2"] },
    } as never);
    expect(chain.length).toBeGreaterThan(0);
    expect(temRetry(chain[0])).toBe(true);
  });

  it("TODO cliente da cadeia tem retry — nenhum braco ficou de fora", () => {
    const chain = resolveProviderChain({
      primary: "openai",
      fallback: ["anthropic"],
      apiKeys: { openai: ["k1"], anthropic: ["a1", "a2"] },
    } as never);
    const semRetry = chain.filter((c) => !temRetry(c));
    expect(semRetry).toEqual([]);
  });

  it("CONTRAPROVA — sem chave nenhuma a cadeia LANCA, e nao devolve vazio em silencio", () => {
    // O comportamento pré-existente, preservado: falhar alto em vez de devolver uma cadeia vazia que
    // só quebraria no primeiro turno (`error-handling.md § 2`).
    const chamar = () =>
      resolveProviderChain({ primary: "nao-existe-mesmo", apiKeys: {} } as never);
    expect(chamar).toThrow(/provider/i);
  });
});
