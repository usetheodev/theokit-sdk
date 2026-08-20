/**
 * normalizeUsage — convert provider-shaped raw `usage` object to
 * canonical `TokenUsage`. Ports Hermes Agent's `normalize_usage`
 * (reference/peer-agent/agent/usage_pricing.py:672-742).
 *
 * Handles 3 API shapes:
 *   - Anthropic Messages: 4 explicit buckets (input/output/cache_read/cache_creation).
 *   - OpenAI Chat Completions: prompt_tokens INCLUDES cache; subtract cached_tokens.
 *   - OpenAI Responses (Codex): input_tokens INCLUDES cache; same subtraction.
 *
 * Edge cases:
 *   - a peer#10266 — OpenAI-compat proxies (OpenRouter, a peer vendor AI Gateway,
 *     a peer) routing Claude expose Anthropic-style top-level fields
 *     (cache_read_input_tokens / cache_creation_input_tokens). Both
 *     locations are checked with top-level fallback.
 *   - Null/undefined fields → 0 via `int()` coerce.
 *   - String token counts → parsed via int.
 *   - Negative values → clamped to 0 (defensive against proxy bugs).
 *
 * @internal
 */

import type { TokenUsage } from "@theokit/sdk";

type ApiMode = "anthropic_messages" | "openai_chat_completions" | "openai_responses";

function int(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

function buildTotal(buckets: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): number {
  // total = visible input + cache buckets + output (reasoning counted via output)
  return (
    buckets.inputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
  );
}

function omitUndefined(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}): TokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.cacheReadTokens > 0 ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(usage.cacheWriteTokens > 0 ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    ...(usage.reasoningTokens > 0 ? { reasoningTokens: usage.reasoningTokens } : {}),
    totalTokens: usage.totalTokens,
  };
}

/**
 * Which usage dialect a provider reports in, inferred from its name.
 *
 * Providers do not agree on the shape of a usage object: Anthropic reports `input_tokens` /
 * `output_tokens`, OpenAI's Responses API reports yet another, and the large
 * OpenAI-chat-compatible family (openai, openrouter, deepseek, google, ollama, lmstudio, …) shares
 * one. This maps a provider name onto that choice.
 *
 * UNKNOWN NAMES FALL BACK to the OpenAI chat-completions shape, because that is what almost every
 * compatible endpoint speaks — a new proxy usually works without a change here. Pass
 * {@link normalizeUsage}'s `apiMode` explicitly when a provider is compatible in its wire format but
 * not in its name.
 */
export function inferApiMode(provider: string): ApiMode {
  const p = provider.toLowerCase();
  if (p === "anthropic" || p === "claude" || p === "bedrock_anthropic") {
    return "anthropic_messages";
  }
  if (p === "openai-codex" || p === "codex") return "openai_responses";
  // openai, openrouter, deepseek, google (compat), ollama (compat), lmstudio (compat), etc
  return "openai_chat_completions";
}

interface RawRecord {
  [k: string]: unknown;
}

/**
 * Turn a provider's raw usage object into the SDK's canonical {@link TokenUsage}.
 *
 * NEVER THROWS, and that is the point: usage arrives from a third party at the end of a successful
 * call, so a missing or malformed field must not fail a request the model already answered. `null`,
 * `undefined` and non-objects all yield an all-zero usage, and unrecognised fields are dropped.
 *
 * The cost of that tolerance is that a zero is ambiguous — it means "the provider reported nothing
 * usable" as readily as "no tokens". A budget that suddenly stops accruing is the symptom of a
 * dialect mismatch, not of free traffic.
 *
 * `apiMode` overrides the guess {@link inferApiMode} makes from the provider name; supply it for a
 * compatible endpoint whose name is not recognised.
 */
export function normalizeUsage(
  rawUsage: unknown,
  opts: { provider: string; apiMode?: ApiMode },
): TokenUsage {
  if (rawUsage === null || rawUsage === undefined) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  if (typeof rawUsage !== "object") {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  const raw = rawUsage as RawRecord;
  const mode = opts.apiMode ?? inferApiMode(opts.provider);

  if (mode === "anthropic_messages") return normalizeAnthropic(raw);
  if (mode === "openai_responses") return normalizeOpenAIResponses(raw);
  return normalizeOpenAIChat(raw);
}

function normalizeAnthropic(raw: RawRecord): TokenUsage {
  const inputTokens = int(raw.input_tokens);
  const outputTokens = int(raw.output_tokens);
  const cacheReadTokens = int(raw.cache_read_input_tokens);
  const cacheWriteTokens = int(raw.cache_creation_input_tokens);
  const usage = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: 0,
    totalTokens: buildTotal({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }),
  };
  return omitUndefined(usage);
}

function normalizeOpenAIResponses(raw: RawRecord): TokenUsage {
  const inputTotal = int(raw.input_tokens);
  const outputTokens = int(raw.output_tokens);
  const inputDetails = (raw.input_tokens_details as RawRecord | undefined) ?? {};
  const outputDetails = (raw.output_tokens_details as RawRecord | undefined) ?? {};
  const cacheReadTokens = int(inputDetails.cached_tokens);
  const cacheWriteTokens = int(inputDetails.cache_creation_tokens);
  const reasoningTokens = int(outputDetails.reasoning_tokens);
  const inputTokens = Math.max(0, inputTotal - cacheReadTokens - cacheWriteTokens);
  const usage = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens: buildTotal({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }),
  };
  return omitUndefined(usage);
}

function normalizeOpenAIChat(raw: RawRecord): TokenUsage {
  const promptTotal = int(raw.prompt_tokens);
  const outputTokens = int(raw.completion_tokens);
  const promptDetails = (raw.prompt_tokens_details as RawRecord | undefined) ?? {};
  const completionDetails = (raw.completion_tokens_details as RawRecord | undefined) ?? {};

  // a peer#10266 fallback — proxies expose Anthropic-style top-level fields when routing Claude
  const cacheReadTokens = int(promptDetails.cached_tokens) || int(raw.cache_read_input_tokens);
  const cacheWriteTokens =
    int(promptDetails.cache_write_tokens) || int(raw.cache_creation_input_tokens);

  const reasoningTokens = int(completionDetails.reasoning_tokens);
  const inputTokens = Math.max(0, promptTotal - cacheReadTokens - cacheWriteTokens);
  const usage = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens: buildTotal({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }),
  };
  return omitUndefined(usage);
}
