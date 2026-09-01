/**
 * Public type contract for token usage + cost tracking (ADRs D376-D379).
 *
 * Surfaces via `RunResult.usage` + `RunResult.cost` after every Run.
 * Re-exported through the package barrel; consumers import from
 * `@theokit/sdk`.
 *
 * @public
 */

/**
 * Token usage observed during a Run. 5 closed buckets (D376) cover
 * 100% of providers in 2026: OpenAI Chat / OpenAI Responses (o-series
 * with reasoning) / Anthropic Messages (with prompt caching).
 *
 * `totalTokens` is derived (`inputTokens + outputTokens`); EC-10
 * invariant: SDK must never emit `totalTokens !== inputTokens + outputTokens`.
 *
 * `requests[]` is the per-request breakdown (mirror a peer SDK)
 * — populated only when the run made > 1 LLM call.
 */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens: number;
  /** Per-request breakdown; absent when the run made a single LLM call. */
  readonly requests?: ReadonlyArray<Omit<TokenUsage, "requests">>;
}

/**
 * Cost confidence level (D377).
 * - `actual`: returned by a provider billing API (e.g. OpenRouter `/generation`).
 * - `estimated`: computed from bundled pricing snapshot.
 * - `included`: subscription-included route (Codex CLI, Claude Pro).
 * - `unknown`: pricing data unavailable; `amountUsd` is undefined.
 */
export type CostStatus = "actual" | "estimated" | "included" | "unknown";

/** Source of the cost figure for caller-side audit. */
export type CostSource =
  | "openrouter_api"
  | "litellm_snapshot"
  | "user_override"
  | "subscription_included"
  | "unknown";

/**
 * Cost breakdown attached to `RunResult.cost`. When `status === "unknown"`,
 * `amountUsd` is `undefined` — DO NOT default to 0 (a lie). The UI shows
 * `n/a` for unknown, `~$1.23` for estimated, `$1.23` for actual.
 */
export interface CostBreakdown {
  readonly amountUsd: number | undefined;
  readonly status: CostStatus;
  readonly currency: "USD";
  readonly source: CostSource;
  readonly pricingVersion: string | undefined;
  readonly notes?: ReadonlyArray<string>;
  /** Per-bucket detail (in USD) for caller analytics. */
  readonly detail?: {
    readonly input?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
    readonly reasoning?: number;
  };
}
