import { describe, expect, it } from "vitest";

import { RetryingLlmClient } from "../../src/internal/llm/retrying-client.js";
import { resolveProviderChain } from "../../src/internal/llm/router.js";

/*
 * M93 T1.2 — the asymmetry between 1 and 2 keys disappears.
 *
 * `buildPoolOrSingle` gave a `PoolAwareLlmClient` — circuit breaker, backoff, `Retry-After`, rotation —
 * when `poolKeys.length >= 2`, and the **raw** transport with one key. The agent-builder resolves
 * exactly one credential (`resolveCredential`), so it **always** fell into the arm without resilience.
 *
 * A pool of 1 key is a pool of size 1: what changes between 1 and 2 is whether there is somewhere to
 * rotate to, not whether retry exists.
 */
/**
 * The router wraps each client with the fault-injection decorator (`maybeWrapWithFaultInjection`,
 * `router.ts:74`), so `chain[0]` is not the `RetryingLlmClient` directly — it sits inside.
 * Walking down the decorator chain is what the test must do to measure the real invariant.
 */
const hasRetry = (c: unknown): boolean => {
  let current = c;
  for (let i = 0; i < 5 && current !== undefined && current !== null; i++) {
    if (current instanceof RetryingLlmClient) return true;
    current = (current as { inner?: unknown; "#inner"?: unknown }).inner;
  }
  return false;
};

describe("M93 — both router arms have retry", () => {
  it("the ONE-key arm returns a client with retry", () => {
    const chain = resolveProviderChain({ primary: "openai", apiKeys: { openai: ["k1"] } } as never);
    expect(chain.length).toBeGreaterThan(0);
    expect(hasRetry(chain[0])).toBe(true);
  });

  it("the TWO-key arm too — the asymmetry disappears", () => {
    const chain = resolveProviderChain({
      primary: "openai",
      apiKeys: { openai: ["k1", "k2"] },
    } as never);
    expect(chain.length).toBeGreaterThan(0);
    expect(hasRetry(chain[0])).toBe(true);
  });

  it("EVERY client in the chain retries — no branch was left out", () => {
    const chain = resolveProviderChain({
      primary: "openai",
      fallback: ["anthropic"],
      apiKeys: { openai: ["k1"], anthropic: ["a1", "a2"] },
    } as never);
    const withoutRetry = chain.filter((c) => !hasRetry(c));
    expect(withoutRetry).toEqual([]);
  });

  it("COUNTERPROOF — with no key at all the chain THROWS, and does not silently return empty", () => {
    // Pre-existing behavior, preserved: fail loudly instead of returning an empty chain that would
    // only break on the first turn (`error-handling.md` § 2).
    const callIt = () =>
      resolveProviderChain({ primary: "really-does-not-exist", apiKeys: {} } as never);
    expect(callIt).toThrow(/provider/i);
  });
});
