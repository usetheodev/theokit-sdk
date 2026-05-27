/**
 * normalizeUsage — convert provider-shaped raw `usage` object to
 * canonical `TokenUsage`. Ports Hermes Agent's `normalize_usage`
 * (referencia/hermes-agent/agent/usage_pricing.py:672-742).
 *
 * Handles 3 API shapes:
 *   - Anthropic Messages: 4 explicit buckets (input/output/cache_read/cache_creation).
 *   - OpenAI Chat Completions: prompt_tokens INCLUDES cache; subtract cached_tokens.
 *   - OpenAI Responses (Codex): input_tokens INCLUDES cache; same subtraction.
 *
 * Edge cases:
 *   - cline#10266 — OpenAI-compat proxies (OpenRouter, Vercel AI Gateway,
 *     Cline) routing Claude expose Anthropic-style top-level fields
 *     (cache_read_input_tokens / cache_creation_input_tokens). Both
 *     locations are checked with top-level fallback.
 *   - Null/undefined fields → 0 via `int()` coerce.
 *   - String token counts → parsed via int.
 *   - Negative values → clamped to 0 (defensive against proxy bugs).
 *
 * @internal
 */

import type { TokenUsage } from "../../types/usage.js";

export type ApiMode = "anthropic_messages" | "openai_chat_completions" | "openai_responses";

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

  // cline#10266 fallback — proxies expose Anthropic-style top-level fields when routing Claude
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
