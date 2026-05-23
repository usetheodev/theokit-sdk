/**
 * GCP Vertex AI HTTP error mapper (ADRs D67, D300).
 *
 * Vertex returns `{ error: { code, status, message, details } }` (Google
 * AIP-193 standard error shape).
 *
 * @internal
 */

import {
  AuthenticationError,
  ConfigurationError,
  NetworkError,
  RateLimitError,
  type TheokitAgentError,
  UnknownAgentError,
} from "../../../errors.js";
import { buildErrorMetadata } from "./shared.js";

interface VertexErrorBody {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: unknown;
  };
}

export interface MapVertexErrorArgs {
  status: number;
  body: unknown;
  headers: Headers | undefined;
  endpoint: string;
}

export function mapVertexError(args: MapVertexErrorArgs): TheokitAgentError {
  const parsed = parseBody(args.body);
  const errStatus = parsed.error?.status ?? "";
  const message = parsed.error?.message ?? "Vertex request failed";

  if (args.status === 429 || errStatus === "RESOURCE_EXHAUSTED") {
    return new RateLimitError(`Vertex quota exhausted: ${message}`, {
      metadata: buildErrorMetadata({
        provider: "vertex",
        endpoint: args.endpoint,
        code: "rate_limit",
        status: args.status,
        headers: args.headers,
        body: args.body,
      }),
    });
  }
  if (args.status === 401 || errStatus === "UNAUTHENTICATED") {
    return new AuthenticationError(`Vertex unauthenticated: ${message}`, {
      metadata: buildErrorMetadata({
        provider: "vertex",
        endpoint: args.endpoint,
        code: "auth_failed",
        status: args.status,
        headers: args.headers,
        body: args.body,
      }),
    });
  }
  if (args.status === 403 || errStatus === "PERMISSION_DENIED") {
    return new AuthenticationError(`Vertex permission denied: ${message}`, {
      metadata: buildErrorMetadata({
        provider: "vertex",
        endpoint: args.endpoint,
        code: "auth_failed",
        status: args.status,
        headers: args.headers,
        body: args.body,
      }),
    });
  }
  if (
    args.status === 400 ||
    errStatus === "INVALID_ARGUMENT" ||
    errStatus === "FAILED_PRECONDITION" ||
    errStatus === "NOT_FOUND"
  ) {
    return new ConfigurationError(`Vertex validation: ${message}`, {
      metadata: buildErrorMetadata({
        provider: "vertex",
        endpoint: args.endpoint,
        code: "invalid_request",
        status: args.status,
        headers: args.headers,
        body: args.body,
      }),
    });
  }
  if (args.status === 408 || errStatus === "DEADLINE_EXCEEDED") {
    return new NetworkError(`Vertex timeout: ${message}`, {
      metadata: buildErrorMetadata({
        provider: "vertex",
        endpoint: args.endpoint,
        code: "timeout",
        status: args.status,
        headers: args.headers,
        body: args.body,
      }),
    });
  }
  if (args.status >= 500) {
    return new NetworkError(`Vertex server error: ${message}`, {
      metadata: buildErrorMetadata({
        provider: "vertex",
        endpoint: args.endpoint,
        code: "server_error",
        status: args.status,
        headers: args.headers,
        body: args.body,
      }),
    });
  }
  return new UnknownAgentError(`Vertex unknown: ${message}`, {
    metadata: buildErrorMetadata({
      provider: "vertex",
      endpoint: args.endpoint,
      code: "unknown",
      status: args.status,
      headers: args.headers,
      body: args.body,
    }),
  });
}

function parseBody(body: unknown): VertexErrorBody {
  if (body !== null && typeof body === "object") return body as VertexErrorBody;
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as VertexErrorBody;
    } catch {
      return {};
    }
  }
  return {};
}
