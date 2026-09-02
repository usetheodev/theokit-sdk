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
} from "../../errors.js";
import { buildErrorMetadata, httpStatusToErrorCode, parseErrorBody } from "./shared.js";

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

type BedrockCode =
  | "rate_limit"
  | "auth_failed"
  | "invalid_request"
  | "quota_exceeded"
  | "timeout"
  | "server_error"
  | "unknown";

function classifyBedrockError(
  args: MapBedrockErrorArgs,
  awsType: string,
  message: string,
): BedrockCode {
  // AWS's `__type` strings and the account-setup message ARE a Bedrock contract, so
  // they are classified here and they win. HTTP 404 stays too: Bedrock is the only
  // mapper that reads it as a validation failure, and folding that into the shared
  // ladder would silently change the other three.
  if (awsType.includes("Throttling") || awsType.includes("TooManyRequests")) {
    return "rate_limit";
  }
  if (awsType.includes("AccessDenied") || awsType.includes("UnauthorizedOperation")) {
    return "auth_failed";
  }
  if (
    args.status === 404 ||
    awsType.includes("ValidationException") ||
    awsType.includes("ResourceNotFound") ||
    message.includes("use case details")
  ) {
    return "invalid_request";
  }
  if (awsType.includes("Timeout")) return "timeout";

  // Everything else is RFC 9110 and lives once, in shared.ts. This arm used to be a
  // fourth copy of the ladder, and it was one of the two that guarded `>= 500` with
  // no upper bound — so a malformed 6xx read as `server_error` here and `unknown` in
  // anthropic / openai-compatible.
  return httpStatusToErrorCode(args.status);
}

function buildBedrockMetadata(args: MapBedrockErrorArgs, code: BedrockCode) {
  return buildErrorMetadata({
    provider: "bedrock",
    endpoint: args.endpoint,
    code,
    status: args.status,
    headers: args.headers,
    body: args.body,
  });
}

export function mapBedrockError(args: MapBedrockErrorArgs): TheokitAgentError {
  const parsed = parseErrorBody<BedrockErrorBody>(args.body);
  const awsType = parsed.__type ?? "";
  const message = parsed.message ?? parsed.Message ?? "Bedrock request failed";
  const code = classifyBedrockError(args, awsType, message);
  const metadata = buildBedrockMetadata(args, code);

  switch (code) {
    case "rate_limit":
      return new RateLimitError(`Bedrock throttled: ${message}`, { metadata });
    case "auth_failed":
      return new AuthenticationError(`Bedrock auth: ${message}`, { metadata });
    case "invalid_request": {
      const friendly = message.includes("use case details")
        ? `Bedrock account setup required: ${message} (AWS Console → Bedrock → Model access → Anthropic → Submit use case form, then retry in 15 min.)`
        : `Bedrock validation: ${message}`;
      return new ConfigurationError(friendly, { metadata });
    }
    case "quota_exceeded":
      return new RateLimitError(`Bedrock quota exceeded: ${message}`, { metadata });
    case "timeout":
      return new NetworkError(`Bedrock timeout: ${message}`, { metadata });
    case "server_error":
      return new NetworkError(`Bedrock server error: ${message}`, { metadata });
    default:
      return new UnknownAgentError(`Bedrock unknown: ${message}`, { metadata });
  }
}
