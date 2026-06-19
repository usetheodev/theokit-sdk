/**
 * Ollama-specific HTTP/transport error mapper (T1.1, ADR D185).
 *
 * Sits ABOVE the generic OpenAI-compatible mapper for `providerId: "ollama"`.
 * Returns `undefined` when the error doesn't match an Ollama-specific
 * pattern — caller (OpenAIClient) then falls back to the generic mapper.
 *
 * Surfaces 3 Ollama-specific failure modes with actionable messages
 * targeted at non-technical users (CLAUDE.md primary persona):
 *
 * 1. **Transport-level `ECONNREFUSED` / `ENOTFOUND`** → "Run `ollama serve`"
 * 2. **HTTP 404 with `not found, try pulling`** → "Run `ollama pull <model>`"
 * 3. **HTTP 503 with `model is loading`** → retryable (model warming up)
 *
 * @internal
 */

import { ConfigurationError, NetworkError, type TheokitAgentError } from "../../errors.js";
import { buildErrorMetadata } from "./shared.js";

interface MapOllamaTransportArgs {
  providerId: string;
  cause: unknown;
  endpoint: string;
}

interface MapOllamaHttpArgs {
  providerId: string;
  status: number;
  body: unknown;
  headers: Headers | undefined;
  endpoint: string;
}

/**
 * Maps fetch-level failures (Node TypeError with `cause.code`). Returns
 * `undefined` for anything that isn't `ECONNREFUSED` / `ENOTFOUND` so
 * the caller can re-throw the original error untouched.
 */
export function mapOllamaTransportError(
  args: MapOllamaTransportArgs,
): TheokitAgentError | undefined {
  if (args.providerId !== "ollama") return undefined;
  const causeCode = extractCauseCode(args.cause);
  if (causeCode !== "ECONNREFUSED" && causeCode !== "ENOTFOUND") return undefined;

  const metadata = buildErrorMetadata({
    provider: "ollama",
    endpoint: args.endpoint,
    code: "network",
    status: 0,
    headers: undefined,
    body: { cause: causeCode },
  });
  return new ConfigurationError(
    "Ollama is not reachable. Run `ollama serve` to start the local runtime, " +
      "or set OLLAMA_HOST to point at a remote Ollama server.",
    { code: "ollama_unreachable", metadata },
  );
}

/**
 * Maps HTTP-level Ollama failures. Returns `undefined` for status codes
 * that aren't Ollama-specific so the caller falls back to the generic
 * OpenAI-compatible mapper.
 */
export function mapOllamaHttpError(args: MapOllamaHttpArgs): TheokitAgentError | undefined {
  if (args.providerId !== "ollama") return undefined;

  const errString = extractErrorString(args.body).toLowerCase();

  // 404 + "not found, try pulling" → model not pulled.
  if (args.status === 404 && errString.includes("not found") && errString.includes("pull")) {
    const modelHint = extractModelName(errString);
    const metadata = buildErrorMetadata({
      provider: "ollama",
      endpoint: args.endpoint,
      code: "model_unavailable",
      status: args.status,
      headers: args.headers,
      body: args.body,
    });
    const pullCmd = modelHint !== undefined ? `ollama pull ${modelHint}` : "ollama pull <model>";
    return new ConfigurationError(
      `Ollama model is not pulled. Run \`${pullCmd}\` to download it first.`,
      { code: "ollama_model_not_pulled", metadata },
    );
  }

  // 503 + "model is loading" → retryable transient.
  if (args.status === 503 && errString.includes("model is loading")) {
    const metadata = buildErrorMetadata({
      provider: "ollama",
      endpoint: args.endpoint,
      code: "server_error",
      status: args.status,
      headers: args.headers,
      body: args.body,
    });
    // NetworkError isRetryable: true (default per errors.ts contract).
    return new NetworkError(
      "Ollama model is loading. Retry in a few seconds — Ollama is warming up the model into memory.",
      { code: "ollama_model_loading", metadata },
    );
  }

  return undefined;
}

function extractCauseCode(cause: unknown): string | undefined {
  if (cause === null || typeof cause !== "object") return undefined;
  // Native fetch wraps in TypeError("fetch failed") with `cause` chain.
  const directCode = (cause as { code?: unknown }).code;
  if (typeof directCode === "string") return directCode;
  const nested = (cause as { cause?: unknown }).cause;
  if (nested !== undefined) return extractCauseCode(nested);
  return undefined;
}

function extractErrorString(body: unknown): string {
  if (typeof body === "string") return body;
  if (body === null || typeof body !== "object") return "";
  const err = (body as { error?: unknown }).error;
  if (typeof err === "string") return err;
  return "";
}

/** Pull the model name out of e.g. `model 'llama3.2' not found, try pulling it first`. */
function extractModelName(errString: string): string | undefined {
  const match = errString.match(/'([^']+)'/);
  return match?.[1];
}
