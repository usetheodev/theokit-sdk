/**
 * D14 — Fault injection via `THEOKIT_TEST_RESPONSE_OVERRIDE` env var.
 *
 * Decorator pattern (D127 inspired): wraps any `LlmClient` and short-circuits
 * the network call when:
 *
 *   1. `process.env.NODE_ENV === "test"` (fail-safe gate — prevents production
 *      footgun), AND
 *   2. `process.env.THEOKIT_TEST_RESPONSE_OVERRIDE` is a non-empty JSON string
 *      shaped as `{ "status": number, "body": object | string }`.
 *
 * On any other condition (different NODE_ENV, missing env, malformed JSON),
 * the wrapper delegates to the real client — graceful degradation.
 *
 * Use cases (FAANG-grade chaos testing):
 *
 *   - `{"status":429,"body":{"error":{"code":"rate_limit_exceeded"}}}` →
 *     deterministic RateLimitError without burning real quota
 *   - `{"status":500,"body":{"error":{"code":"internal_error"}}}` →
 *     deterministic NetworkError for retry/circuit-breaker tests
 *   - `{"status":200,"body":{"choices":[{"message":{"content":"fake"}}]}}` →
 *     deterministic happy-path text for snapshot tests
 *
 * Compatible with the dogfood-stranger chaos phases (12-15). Replaces the
 * flaky "50 parallel requests to force 429" anti-pattern.
 *
 * Wire format mirrors OpenAI Chat Completions (universal — same shape every
 * provider returns). Error mapping reuses `mapOpenAICompatibleError` so the
 * injected errors are byte-equal to what the real provider would raise.
 *
 * @internal
 */

import { diag } from "../diagnostics.js";
import { mapOpenAICompatibleError } from "../error-mappers/openai-compatible.js";
import type { LlmClient, LlmEvent, LlmFinish, LlmRequest } from "./types.js";

const ENV_GATE_KEY = "NODE_ENV";
const ENV_GATE_VALUE = "test";
const ENV_OVERRIDE_KEY = "THEOKIT_TEST_RESPONSE_OVERRIDE";

interface ParsedOverride {
  status: number;
  body: unknown;
}

/**
 * Wrap an `LlmClient` with the fault-injection decorator. Returns the
 * original client unchanged when the activation gate is not satisfied
 * (cheap noop — no allocation in the hot path of production runtime).
 */
export function maybeWrapWithFaultInjection(client: LlmClient): LlmClient {
  // Cheap gate first — production calls never allocate the wrapper.
  if (!isGateOn()) return client;
  return new FaultInjectingLlmClient(client);
}

export class FaultInjectingLlmClient implements LlmClient {
  readonly name: string;
  /**
   * Inner (real) client. Exposed so layered transport assertions (router
   * pool-wiring tests, telemetry inspectors) can walk one level deep —
   * same pattern PoolAwareLlmClient uses for its inner transport.
   */
  readonly inner: LlmClient;
  constructor(inner: LlmClient) {
    this.inner = inner;
    this.name = inner.name;
  }

  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    // Re-check gate on every call — env vars can change between calls and
    // the cost is negligible relative to a network roundtrip.
    if (!isGateOn()) {
      return yield* this.inner.stream(request, signal);
    }
    const parsed = parseOverrideOrWarnOnce();
    if (parsed === undefined) {
      return yield* this.inner.stream(request, signal);
    }
    // Active: synthesize response without calling the real client.
    if (parsed.status >= 400) {
      throw mapOpenAICompatibleError({
        providerId: this.name,
        status: parsed.status,
        body: parsed.body,
        headers: undefined,
        endpoint: "/v1/chat/completions",
      });
    }
    const text = extractText(parsed.body);
    yield { type: "text_delta", text };
    // theokit#144: no `stop` event — the reason travels on the finish value below.
    return {
      stopReason: "end_turn",
      text,
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

function isGateOn(): boolean {
  return process.env[ENV_GATE_KEY] === ENV_GATE_VALUE;
}

let warnedInvalidJson = false;

function parseOverrideOrWarnOnce(): ParsedOverride | undefined {
  const raw = process.env[ENV_OVERRIDE_KEY];
  if (raw === undefined || raw.length === 0) return undefined;
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch (_err) {
    warnInvalidJsonOnce(raw);
    return undefined;
  }
  if (candidate === null || typeof candidate !== "object") {
    warnInvalidJsonOnce(raw);
    return undefined;
  }
  const obj = candidate as { status?: unknown; body?: unknown };
  if (typeof obj.status !== "number" || !Number.isFinite(obj.status)) {
    warnInvalidJsonOnce(raw);
    return undefined;
  }
  return { status: obj.status, body: obj.body };
}

function warnInvalidJsonOnce(_raw: string): void {
  if (warnedInvalidJson) return;
  warnedInvalidJson = true;
  diag(
    `[theokit-sdk] ${ENV_OVERRIDE_KEY} is set but value is not valid JSON of shape ` +
      `\`{"status": number, "body": object | string}\`. Falling back to real LLM call. ` +
      `This warning is shown once per process.\n`,
  );
}

/**
 * Extract textual content from an arbitrary body. Supports:
 *   - plain string: returned as-is
 *   - OpenAI shape: `body.choices[0].message.content` (most common)
 *   - object with `text` field: `body.text`
 *   - everything else: empty string (caller can still inspect parsed.body if needed)
 */
function extractText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body === null || typeof body !== "object") return "";
  const fromOpenAi = readOpenAiContent(body);
  if (fromOpenAi !== undefined) return fromOpenAi;
  const obj = body as { text?: unknown };
  if (typeof obj.text === "string") return obj.text;
  return "";
}

function readOpenAiContent(body: unknown): string | undefined {
  const obj = body as { choices?: unknown };
  if (!Array.isArray(obj.choices) || obj.choices.length === 0) return undefined;
  const first = obj.choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  if (typeof content === "string") return content;
  return undefined;
}

/**
 * Test-only reset for the one-shot stderr warning. Mirrors the D187
 * `_resetNoAuthApiKeyWarnings` pattern.
 *
 * @internal
 */
export function _resetFaultInjectionWarnings(): void {
  warnedInvalidJson = false;
}
