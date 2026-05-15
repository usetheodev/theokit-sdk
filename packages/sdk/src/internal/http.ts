import {
  AuthenticationError,
  ConfigurationError,
  IntegrationNotConnectedError,
  NetworkError,
  RateLimitError,
  type TheokitAgentError,
  UnknownAgentError,
} from "../errors.js";
import { getConfiguredBaseUrl } from "./fixture-mode.js";

/**
 * Default base URL used when neither `THEOKIT_API_BASE_URL` nor an explicit
 * override is provided. The fixture-mode short-circuit normally bypasses this
 * for `theo_test_*` keys; consumers with real keys hit this URL.
 *
 * @internal
 */
export const DEFAULT_BASE_URL = "https://api.usetheo.dev";

/**
 * HTTP request options accepted by {@link httpRequest}.
 *
 * @internal
 */
export interface HttpRequestOptions {
  apiKey: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Override the default `fetch` (useful for tests / instrumentation). */
  fetchFn?: typeof globalThis.fetch;
  /** Extra headers merged into the default set. */
  headers?: Record<string, string>;
}

/**
 * Server-side error envelope (`{ error: { code, message, ... } }` or a flat
 * shape) parsed off non-2xx responses.
 *
 * @internal
 */
interface ErrorEnvelope {
  code?: string;
  message?: string;
  protoErrorCode?: string;
  provider?: string;
  helpUrl?: string;
}

/**
 * Resolve the effective base URL (explicit env > default).
 *
 * @internal
 */
export function resolveBaseUrl(): string {
  return getConfiguredBaseUrl() ?? DEFAULT_BASE_URL;
}

/**
 * Perform an authenticated JSON HTTP request, mapping non-2xx responses to
 * the public typed-error hierarchy. Throws subclasses of `TheokitAgentError`
 * on failure.
 *
 * @internal
 */
export async function httpRequest<T>(path: string, options: HttpRequestOptions): Promise<T> {
  const url = `${resolveBaseUrl()}${path}`;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${options.apiKey}`,
    ...(options.headers ?? {}),
  };
  const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;

  const response = await safeFetch(fetchFn, url, {
    method: options.method ?? "GET",
    headers,
    body,
  });

  if (!response.ok) {
    const parsed = await safeParseJsonResponse(response);
    throw mapHttpStatusToError(response.status, parsed);
  }

  return (await safeParseJsonResponse(response)) as T;
}

async function safeFetch(
  fetchFn: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (cause) {
    throw new NetworkError("HTTP request failed", { code: "network_error", cause });
  }
}

async function safeParseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Translate an HTTP error response into a typed `TheokitAgentError` subclass.
 *
 * @internal
 */
export function mapHttpStatusToError(status: number, body: unknown): TheokitAgentError {
  const envelope = extractErrorEnvelope(body);
  const message = envelope.message ?? `HTTP ${status}`;
  const errorOptions = {
    code: envelope.code,
    protoErrorCode: envelope.protoErrorCode,
    cause: body,
  };

  if (envelope.code === "integration_not_connected") {
    return new IntegrationNotConnectedError(message, {
      provider: envelope.provider ?? "unknown",
      helpUrl: envelope.helpUrl ?? "",
      code: envelope.code,
      cause: body,
    });
  }
  if (status === 401 || status === 403) {
    return new AuthenticationError(message, errorOptions);
  }
  if (status === 429) {
    return new RateLimitError(message, errorOptions);
  }
  if (status >= 400 && status < 500) {
    return new ConfigurationError(message, errorOptions);
  }
  if (status >= 500) {
    return new NetworkError(message, errorOptions);
  }
  return new UnknownAgentError(message, errorOptions);
}

function extractErrorEnvelope(body: unknown): ErrorEnvelope {
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;
  const inner = record.error;
  const source: unknown = inner && typeof inner === "object" ? inner : record;
  return readEnvelopeFields(source as Record<string, unknown>);
}

function readEnvelopeFields(record: Record<string, unknown>): ErrorEnvelope {
  return {
    code: pickString(record, "code"),
    message: pickString(record, "message"),
    protoErrorCode: pickString(record, "protoErrorCode"),
    provider: pickString(record, "provider"),
    helpUrl: pickString(record, "helpUrl"),
  };
}

function pickString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
