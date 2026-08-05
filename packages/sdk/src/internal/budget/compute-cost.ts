/**
 * computeCost — apply pricing entries to a TokenUsage and produce a
 * CostBreakdown (ADRs D377, D378).
 *
 * Edge cases absorbed:
 *   - EC-13: negative pricing → status="unknown" + note.
 *   - EC-14: reasoning tokens fall back to outputCostPerMillion when
 *     dedicated reasoning rate is undefined.
 *   - EC-12: money precision via microcent normalization (× 1e6).
 *   - "subscription_included" routes (Codex CLI, future Claude Pro) →
 *     return $0 with status="included".
 *   - Provider unknown / pricing missing → status="unknown" with
 *     undefined amountUsd (does NOT return a false 0).
 *
 * @internal
 */

import type { CostBreakdown, TokenUsage } from "../../types/usage.js";
import { getPricingEntry, type PricingEntry } from "./pricing-registry.js";

const MICROCENT = 1e6;

function isSubscriptionIncluded(provider: string): boolean {
  return provider === "openai-codex" || provider === "codex";
}

function pricingHasValidRates(entry: PricingEntry): boolean {
  // EC-13: negative pricing is corrupt data.
  return (
    entry.inputCostPerMillion >= 0 &&
    entry.outputCostPerMillion >= 0 &&
    (entry.cacheReadCostPerMillion === undefined || entry.cacheReadCostPerMillion >= 0) &&
    (entry.cacheWriteCostPerMillion === undefined || entry.cacheWriteCostPerMillion >= 0) &&
    (entry.reasoningCostPerMillion === undefined || entry.reasoningCostPerMillion >= 0)
  );
}

function costForTokens(tokens: number, perMillion: number): number {
  // EC-12: microcent precision; (tokens × $/Mtok × 1e6) / 1e6 / 1e6
  // Round to microcents to avoid float drift across additions.
  if (tokens === 0 || perMillion === 0) return 0;
  return Math.round((tokens * perMillion * MICROCENT) / 1_000_000) / MICROCENT;
}

interface ComputeArgs {
  readonly usage: TokenUsage;
  readonly provider: string;
  readonly model: string;
  readonly baseUrl?: string;
}

/**
 * Returns CostBreakdown with `status="estimated"`, `"unknown"`, or
 * `"included"`. Never throws; never returns 0 when pricing is missing.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 5-bucket pricing math + 4 fail-paths is inherently branchy; splitting adds indirection without reducing complexity.
export function computeCost(args: ComputeArgs): CostBreakdown {
  // subscription_included route
  if (isSubscriptionIncluded(args.provider)) {
    return {
      amountUsd: 0,
      status: "included",
      currency: "USD",
      source: "subscription_included",
      pricingVersion: undefined,
    };
  }

  const entry = getPricingEntry({
    provider: args.provider,
    model: args.model,
    ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
  });
  if (entry === undefined) {
    return {
      amountUsd: undefined,
      status: "unknown",
      currency: "USD",
      source: "unknown",
      pricingVersion: undefined,
    };
  }

  // EC-13: negative pricing entry
  if (!pricingHasValidRates(entry)) {
    return {
      amountUsd: undefined,
      status: "unknown",
      currency: "USD",
      source: "unknown",
      pricingVersion: entry.pricingVersion,
      notes: ["pricing entry has negative rates; treated as invalid"],
    };
  }

  const notes: string[] = [];
  const detail: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    reasoning?: number;
  } = {};

  const u = args.usage;
  const inputCost = costForTokens(u.inputTokens, entry.inputCostPerMillion);
  const outputCost = costForTokens(u.outputTokens, entry.outputCostPerMillion);
  detail.input = inputCost;
  detail.output = outputCost;
  let total = inputCost + outputCost;

  // Cache buckets — only if pricing available, otherwise mark unknown
  if (u.cacheReadTokens !== undefined && u.cacheReadTokens > 0) {
    if (entry.cacheReadCostPerMillion === undefined) {
      return {
        amountUsd: undefined,
        status: "unknown",
        currency: "USD",
        source: "litellm_snapshot",
        pricingVersion: entry.pricingVersion,
        notes: ["cache-read tokens present but cacheReadCostPerMillion is undefined"],
      };
    }
    const c = costForTokens(u.cacheReadTokens, entry.cacheReadCostPerMillion);
    detail.cacheRead = c;
    total += c;
  }
  if (u.cacheWriteTokens !== undefined && u.cacheWriteTokens > 0) {
    if (entry.cacheWriteCostPerMillion === undefined) {
      return {
        amountUsd: undefined,
        status: "unknown",
        currency: "USD",
        source: "litellm_snapshot",
        pricingVersion: entry.pricingVersion,
        notes: ["cache-write tokens present but cacheWriteCostPerMillion is undefined"],
      };
    }
    const c = costForTokens(u.cacheWriteTokens, entry.cacheWriteCostPerMillion);
    detail.cacheWrite = c;
    total += c;
  }

  // EC-14: reasoning tokens fall back to output rate
  if (u.reasoningTokens !== undefined && u.reasoningTokens > 0) {
    const rate = entry.reasoningCostPerMillion ?? entry.outputCostPerMillion;
    const c = costForTokens(u.reasoningTokens, rate);
    detail.reasoning = c;
    total += c;
    if (entry.reasoningCostPerMillion === undefined) {
      notes.push("reasoning tokens billed at output rate (no dedicated reasoning rate available)");
    }
  }

  // Round total to microcents
  const amountUsd = Math.round(total * MICROCENT) / MICROCENT;

  return {
    amountUsd,
    status: "estimated",
    currency: "USD",
    source: "litellm_snapshot",
    pricingVersion: entry.pricingVersion,
    ...(notes.length > 0 ? { notes } : {}),
    detail,
  };
}
