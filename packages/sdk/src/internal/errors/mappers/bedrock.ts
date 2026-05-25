/**
 * AWS Bedrock HTTP error mapper (ADRs D67, D300).
 *
 * Bedrock returns either AWS-style `{ message, __type: "ThrottlingException" }`
 * or sometimes `{ Message }` (capitalized) depending on the model dialect.
 * We accept both shapes and map to canonical `TheokitAgentError` subclasses.
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

interface BedrockErrorBody {
  __type?: string;
  message?: string;
  Message?: string;
}

export interface MapBedrockErrorArgs {
  status: number;
  body: unknown;
  headers: Headers | undefined;
  endpoint: string;
}

export function mapBedrockError(args: MapBedrockErrorArgs): TheokitAgentError {
  const parsed = parseBody(args.body);
  const awsType = parsed.__type ?? "";
  const message = parsed.message ?? parsed.Message ?? "Bedrock request failed";

  // Throttling first — AWS uses 400 with __type for many errors, so status alone is unreliable.
  if (
    args.status === 429 ||
    awsType.includes("Throttling") ||
    awsType.includes("TooManyRequests")
  ) {
    return new RateLimitError(`Bedrock throttled: ${message}`, {
      metadata: buildErrorMetadata({
        provider: "bedrock",
        endpoint: args.endpoint,
        code: "rate_limit",
        status: args.status,
        headers: args.headers,
        body: args.body,
      }),
    });
  }
  if (
    args.status === 401 ||
    args.status === 403 ||
    awsType.includes("AccessDenied") ||
    awsType.includes("UnauthorizedOperation")
  ) {
    return new AuthenticationError(`Bedrock auth: ${message}`, {
      metadata: buildErrorMetadata({
        provider: "bedrock",
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
    args.status === 404 ||
    awsType.includes("ValidationException") ||
    awsType.includes("ResourceNotFound") ||
    message.includes("use case details")
  ) {
    const isUseCaseGate = message.includes("use case details");
    const friendly = isUseCaseGate
      ? `Bedrock account setup required: ${message} (AWS Console → Bedrock → Model access → Anthropic → Submit use case form, then retry in 15 min.)`
      : `Bedrock validation: ${message}`;
    return new ConfigurationError(friendly, {
      metadata: buildErrorMetadata({
        provider: "bedrock",
        endpoint: args.endpoint,
        code: "invalid_request",
        status: args.status,
        headers: args.headers,
        body: args.body,
      }),
    });
  }
  if (args.status === 408 || awsType.includes("Timeout")) {
    return new NetworkError(`Bedrock timeout: ${message}`, {
      metadata: buildErrorMetadata({
        provider: "bedrock",
        endpoint: args.endpoint,
        code: "timeout",
        status: args.status,
        headers: args.headers,
        body: args.body,
      }),
    });
  }
  if (args.status >= 500) {
    return new NetworkError(`Bedrock server error: ${message}`, {
      metadata: buildErrorMetadata({
        provider: "bedrock",
        endpoint: args.endpoint,
        code: "server_error",
        status: args.status,
        headers: args.headers,
        body: args.body,
      }),
    });
  }
  return new UnknownAgentError(`Bedrock unknown: ${message}`, {
    metadata: buildErrorMetadata({
      provider: "bedrock",
      endpoint: args.endpoint,
      code: "unknown",
      status: args.status,
      headers: args.headers,
      body: args.body,
    }),
  });
}

function parseBody(body: unknown): BedrockErrorBody {
  if (body !== null && typeof body === "object") return body as BedrockErrorBody;
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as BedrockErrorBody;
    } catch {
      return {};
    }
  }
  return {};
}
