import { describe, expect, it } from "vitest";

import { RetryingLlmClient } from "../src/internal/llm/retrying-client.js";
import { resolveProviderChain } from "../src/internal/llm/router.js";

/**
 * M93 T1.2 — a assimetria entre 1 e 2 chaves some.
 *
 * `buildPoolOrSingle` gave a `PoolAwareLlmClient` — circuit breaker, backoff, `Retry-After`, rotation —
 * quando `poolKeys.length >= 2`, e o transporte **cru** com uma chave. O agent-builder resolve
 * exactly one credential (`resolveCredential`), so it **always** fell into the arm without resilience.
 *
 * A pool of 1 key is a pool of size 1: what changes between 1 and 2 is whether there is somewhere to
 * rotate to, not whether retry exists.
 */
/**
 * O router envolve cada cliente com o decorator de fault-injection (`maybeWrapWithFaultInjection`,
 * `router.ts:74`), so `chain[0]` is not the `RetryingLlmClient` directly — it sits inside.
 * Walking down the decorator chain is what the test must do to measure the real invariant.
 */
const temRetry = (c: unknown): boolean => {
  let atual = c;
  for (let i = 0; i < 5 && atual !== undefined && atual !== null; i++) {
    if (atual instanceof RetryingLlmClient) return true;
    atual = (atual as { inner?: unknown; ["#inner"]?: unknown }).inner;
  }
  return false;
};

describe("M93 — both router arms have retry", () => {
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
    // Pre-existing behavior, preserved: fail loudly instead of returning an empty chain that would
    // only break on the first turn (`error-handling.md` § 2).
    const chamar = () =>
      resolveProviderChain({ primary: "nao-existe-mesmo", apiKeys: {} } as never);
    expect(chamar).toThrow(/provider/i);
  });
});
