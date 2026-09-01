import { describe, expect, it } from "vitest";
import type { AgentLoopInputs } from "../../src/internal/agent-loop/types.js";
import { accumulateUsage, computeUsageCost } from "../../src/internal/agent-loop/usage-and-cost.js";
import { UsageAccumulator } from "../../src/internal/budget/usage-accumulator.js";
import type { TokenUsage } from "../../src/types/usage.js";

/**
 * B-038 flags this module as the financially consequential one: `computeUsageCost`
 * produces the number a customer is billed against and that sdk-budget enforces on.
 *
 * Its sibling `compute-cost.ts` (the pricing arithmetic) has its own suite. What
 * is untested is THIS module's decision — which provider and which model name are
 * handed to that arithmetic. Pick the wrong pair and the price is looked up in the
 * wrong row of the registry, which is a wrong bill rather than a crash.
 *
 * The oracle uses `codex`, the one provider `computeCost` routes to
 * `subscription_included`. That makes the resolved provider directly observable
 * in the result instead of requiring a hard-coded dollar figure that would break
 * on every price-list update.
 */
const inputs = (modelId: string | undefined, llmName: string): AgentLoopInputs =>
  ({ model: { id: modelId }, llm: { name: llmName } }) as unknown as AgentLoopInputs;

const usage: TokenUsage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };

describe("computeUsageCost — when no cost can be attributed", () => {
  it("returns undefined when the model id is unset", () => {
    expect(computeUsageCost(inputs(undefined, "openai"), usage)).toBeUndefined();
  });

  it("returns undefined for the `auto` sentinel model", () => {
    // `auto` names no concrete model, so any price would be invented.
    expect(computeUsageCost(inputs("auto", "openai"), usage)).toBeUndefined();
  });

  it("still produces a breakdown for a concrete model id", () => {
    // § 4.2 — the accepting direction. A guard widened to reject every id would
    // silently stop costing every run while passing both rows above.
    expect(computeUsageCost(inputs("codex/gpt-5", "openai"), usage)).toBeDefined();
  });
});

describe("computeUsageCost — provider resolution", () => {
  it("takes the provider from the model id prefix", () => {
    const cost = computeUsageCost(inputs("codex/gpt-5", "anthropic"), usage);

    expect(cost?.source).toBe("subscription_included");
    expect(cost?.status).toBe("included");
  });

  it("falls back to the LlmClient name when the model id carries no prefix", () => {
    // OpenRouter-style passthrough: the id is bare, and the client is the only
    // thing that knows who is actually being billed.
    const cost = computeUsageCost(inputs("gpt-5", "codex"), usage);

    expect(cost?.source).toBe("subscription_included");
  });

  it("lets the model id prefix win over the LlmClient name", () => {
    const cost = computeUsageCost(inputs("openai/gpt-4o-mini", "codex"), usage);

    // If the fallback took precedence, this run would be billed as an included
    // subscription and the customer would be undercharged to zero.
    expect(cost?.source).not.toBe("subscription_included");
  });

  it("reports unknown rather than guessing for an unrecognised provider", () => {
    const cost = computeUsageCost(inputs("no-such-vendor/mystery-1", "no-such-vendor"), usage);

    expect(cost?.status).toBe("unknown");
    expect(cost?.amountUsd).toBeUndefined();
  });

  it("does not treat a bare id as a prefixed one", () => {
    const cost = computeUsageCost(inputs("gpt-4o-mini", "no-such-vendor"), usage);

    expect(cost?.status).toBe("unknown");
  });
});

describe("computeUsageCost — model-name resolution", () => {
  /**
   * The other half of the same billing decision, and the half that is easy to
   * miss: having picked the provider, this module must also strip the prefix
   * off the model NAME before the registry lookup.
   *
   * Handing the registry the full `anthropic/claude-opus-4.7` instead of
   * `claude-opus-4.7` is not harmless. `getPricingEntry`'s slash-tolerant step
   * rescues most ids, but NOT the dot-suffixed Anthropic form, which only the
   * `${provider}/${cleaned}` step handles — so the lookup misses and the run
   * comes back `unknown`, i.e. billed as nothing at all.
   */
  it("strips the provider prefix before the registry lookup", () => {
    const cost = computeUsageCost(inputs("anthropic/claude-opus-4.7", "anthropic"), usage);

    // Passing the un-stripped id through would return status "unknown" with an
    // undefined amount — a priced run silently costed at zero.
    expect(cost?.status).toBe("estimated");
    expect(cost?.amountUsd).toBeGreaterThan(0);
  });

  it("keeps the whole id as the model name when there is no prefix to strip", () => {
    const cost = computeUsageCost(inputs("gpt-4o-mini", "openai"), usage);

    expect(cost?.status).toBe("estimated");
    expect(cost?.amountUsd).toBeGreaterThan(0);
  });
});

describe("accumulateUsage", () => {
  it("records nothing when the turn surfaced no token buckets at all", () => {
    const acc = new UsageAccumulator();

    accumulateUsage(acc, {});

    // D376: a pure-error turn must not create a spurious zero-token step.
    expect(acc.hasAny()).toBe(false);
  });

  it("records a turn that reported input tokens", () => {
    const acc = new UsageAccumulator();

    accumulateUsage(acc, { inputTokens: 12 });

    expect(acc.hasAny()).toBe(true);
    expect(acc.toTokenUsage().inputTokens).toBe(12);
  });

  it("treats an explicit zero as a reported bucket, not as absence", () => {
    const acc = new UsageAccumulator();

    accumulateUsage(acc, { inputTokens: 0 });

    // Edge case: 0 is a measurement ("this turn cost nothing"), undefined is the
    // absence of one. Collapsing them would drop real zero-token steps.
    expect(acc.hasAny()).toBe(true);
  });

  it("forwards all five buckets to the accumulator", () => {
    const acc = new UsageAccumulator();

    accumulateUsage(acc, {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      reasoningTokens: 5,
    });

    expect(acc.toTokenUsage()).toMatchObject({
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      reasoningTokens: 5,
    });
  });

  it("records a partial-failure turn that only surfaced reasoning tokens", () => {
    const acc = new UsageAccumulator();

    accumulateUsage(acc, { reasoningTokens: 7 });

    // D376: errored turns still spent money; dropping them understates the bill.
    expect(acc.hasAny()).toBe(true);
    expect(acc.toTokenUsage().reasoningTokens).toBe(7);
  });

  it("sums successive turns instead of replacing them", () => {
    const acc = new UsageAccumulator();

    accumulateUsage(acc, { inputTokens: 10, outputTokens: 1 });
    accumulateUsage(acc, { inputTokens: 5, outputTokens: 2 });

    expect(acc.toTokenUsage()).toMatchObject({
      inputTokens: 15,
      outputTokens: 3,
      totalTokens: 18,
    });
  });
});
