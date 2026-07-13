/**
 * Cost — estimate the USD cost of a run's token usage from the pricing snapshot. Deterministic.
 *
 * `computeCost` maps a `{ usage, provider, model }` to a `CostBreakdown` (amount + per-bucket detail)
 * using the bundled pricing snapshot — no network, no LLM.
 */
import { computeCost } from "@theokit/sdk";

const cost = computeCost({
  usage: { inputTokens: 1500, outputTokens: 500 },
  provider: "openai",
  model: "gpt-4o-mini",
});

console.log("Amount USD:", cost.amountUsd);
console.log("Status:    ", cost.status);
console.log("Breakdown: ", JSON.stringify(cost.detail));
