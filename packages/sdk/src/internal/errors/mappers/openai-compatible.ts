/**
 * OpenAI-compatible HTTP error mapper (ADR D67).
 *
 * Translates OpenAI-shaped API error responses (covers OpenAI, OpenRouter,
 * DeepSeek, Together, Mistral, Voyage, DeepInfra, etc.) into typed
 * `TheokitAgentError` subclasses with full `ErrorMetadata`.
 *
 * Body inspection: looks at `body.error.code` / `body.error.type` to detect
 * `context_too_long`, `content_filtered`, `model_unavailable` semantics.
 * Falls back to status-based mapping when body doesn't expose `.error`
 * (e.g., HTML server error page, DeepInfra's `{message: "..."}` shape).
 *
 * Never throws — caller is already in an error path.
 *
 * @internal
 */

import {
  AuthenticationError,
  ConfigurationError,
  type ErrorCode,
  NetworkError,
  RateLimitError,
  type TheokitAgentError,
  UnknownAgentError,
} from "../../../errors.js";
import { buildErrorMetadata } from "./shared.js";

interface MapOpenAiErrorArgs {
  providerId: string;
  status: number;
  body: unknown;
  headers: Headers | undefined;
  endpoint: string;
}

export function mapOpenAICompatibleError(args: MapOpenAiErrorArgs): TheokitAgentError {
  const { providerId, status, body, headers, endpoint } = args;
  const code = mapOpenAiStatusToCode(status, body);
  const message = formatMessage(providerId, status, code);
  const metadata = buildErrorMetadata({
    provider: providerId,
    endpoint,
    code,
    status,
    headers,
    body,
  });

  if (status === 401 || status === 403) {
    return new AuthenticationError(message, { code: `${providerId}_auth_failed`, metadata });
  }
  if (status === 429) {
    return new RateLimitError(message, { code: `${providerId}_rate_limit`, metadata });
  }
  if (status === 400) {
    return new ConfigurationError(message, { code: `${providerId}_${code}`, metadata });
  }
  if (status === 408) {
    return new NetworkError(message, { code: `${providerId}_timeout`, metadata });
  }
  if (status >= 500 && status < 600) {
    return new NetworkError(message, { code: `${providerId}_server_error`, metadata });
  }
  return new UnknownAgentError(message, { code: `${providerId}_unknown`, metadata });
}

function extractOpenAiErrorCode(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const err = (body as { error?: { code?: unknown; type?: unknown } }).error;
  if (err === undefined || err === null) return undefined;
  if (typeof err.code === "string") return err.code;
  if (typeof err.type === "string") return err.type;
  return undefined;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: explicit branch table is clearer than splitting
function mapOpenAiStatusToCode(status: number, body: unknown): ErrorCode {
  const rawCode = extractOpenAiErrorCode(body)?.toLowerCase() ?? "";

  if (
    rawCode.includes("context_length") ||
    rawCode.includes("context_window") ||
    rawCode.includes("too_many_tokens") ||
    rawCode.includes("max_tokens")
  ) {
    return "context_too_long";
  }
  if (
    rawCode.includes("content_filter") ||
    rawCode.includes("content_policy") ||
    rawCode.includes("safety")
  ) {
    return "content_filtered";
  }
  if (
    rawCode.includes("model_not_found") ||
    rawCode.includes("model_unavailable") ||
    rawCode.includes("invalid_model")
  ) {
    return "model_unavailable";
  }

  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status === 400) return "invalid_request";
  if (status >= 500 && status < 600) return "server_error";
  return "unknown";
}

function formatMessage(providerId: string, status: number, code: ErrorCode): string {
  return `${providerId} API error: ${code} (HTTP ${status})`;
}
