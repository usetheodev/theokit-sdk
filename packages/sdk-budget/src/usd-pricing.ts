/**
 * Built-in per-model USD pricing table (SDK 2.0 Phase 2 / sdk-budget T2.X).
 *
 * Prices are in USD per 1M tokens (input / output). Sources: each
 * provider's public pricing page; values verified 2026-06 against
 * the same tier used in sdk-core's `internal/budget/pricing-data.json`.
 *
 * The table is intentionally CONSERVATIVE — only the most-used models
 * land here. Consumers needing exhaustive coverage can supply an
 * override via `createUsdBudgetTracker({ pricing })`.
 *
 * @public
 */

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  readonly inputPerMillionUsd: number;
  /** USD per 1,000,000 output tokens. */
  readonly outputPerMillionUsd: number;
}

/** Built-in pricing table — exhaustive enough for v0.1; users supply overrides for niche models. */
export const BUILTIN_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({
  // OpenAI / OpenRouter aliases
  "openai/gpt-4o": { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
  "openai/gpt-4o-mini": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  "openai/gpt-4-turbo": { inputPerMillionUsd: 10, outputPerMillionUsd: 30 },
  "openai/gpt-3.5-turbo": { inputPerMillionUsd: 0.5, outputPerMillionUsd: 1.5 },
  // Anthropic / Claude
  "anthropic/claude-3-5-sonnet-latest": { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  "anthropic/claude-3-5-haiku-latest": { inputPerMillionUsd: 0.8, outputPerMillionUsd: 4 },
  "anthropic/claude-3-opus-latest": { inputPerMillionUsd: 15, outputPerMillionUsd: 75 },
  // Google
  "google/gemini-1.5-pro": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 5 },
  "google/gemini-1.5-flash": { inputPerMillionUsd: 0.075, outputPerMillionUsd: 0.3 },
});

/**
 * Compute USD cost for a single token event.
 *
 * Returns `undefined` (NOT `0`, NOT throws) when the model is UNKNOWN — its
 * cost is genuinely unknown, and coercing it to `$0` would be dishonest (cost
 * contract `D377-cost-status-closed-enum.md`: amount-unknown ≠ `$0`). Consumers
 * who want a price for a niche model supply an override via
 * `createUsdBudgetTracker({ pricing })`. A KNOWN model with zero/invalid tokens
 * returns `0` — that is a real, known `$0`.
 */
export function computeUsdCost(
  pricing: Readonly<Record<string, ModelPricing>>,
  model: string,
  type: "input" | "output",
  tokens: number,
): number | undefined {
  const entry = pricing[model];
  if (entry === undefined) return undefined;
  const ratePerMillion = type === "input" ? entry.inputPerMillionUsd : entry.outputPerMillionUsd;
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return (tokens / 1_000_000) * ratePerMillion;
}
