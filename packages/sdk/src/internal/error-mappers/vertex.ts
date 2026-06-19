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
} from "../../errors.js";
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

type VertexCode =
  | "rate_limit"
  | "auth_unauthenticated"
  | "auth_permission"
  | "invalid_request"
  | "timeout"
  | "server_error"
  | "unknown";

const VERTEX_RULES: ReadonlyArray<{ test: (s: number, e: string) => boolean; code: VertexCode }> = [
  { test: (s, e) => s === 429 || e === "RESOURCE_EXHAUSTED", code: "rate_limit" },
  { test: (s, e) => s === 401 || e === "UNAUTHENTICATED", code: "auth_unauthenticated" },
  { test: (s, e) => s === 403 || e === "PERMISSION_DENIED", code: "auth_permission" },
  {
    test: (s, e) =>
      s === 400 || e === "INVALID_ARGUMENT" || e === "FAILED_PRECONDITION" || e === "NOT_FOUND",
    code: "invalid_request",
  },
  { test: (s, e) => s === 408 || e === "DEADLINE_EXCEEDED", code: "timeout" },
  { test: (s) => s >= 500, code: "server_error" },
];

function classifyVertexError(args: MapVertexErrorArgs, errStatus: string): VertexCode {
  for (const rule of VERTEX_RULES) {
    if (rule.test(args.status, errStatus)) return rule.code;
  }
  return "unknown";
}

function vertexMetadata(args: MapVertexErrorArgs, code: string) {
  return buildErrorMetadata({
    provider: "vertex",
    endpoint: args.endpoint,
    code: code as Parameters<typeof buildErrorMetadata>[0]["code"],
    status: args.status,
    headers: args.headers,
    body: args.body,
  });
}

const VERTEX_ERROR_BUILDERS: Record<
  VertexCode,
  (args: MapVertexErrorArgs, msg: string) => TheokitAgentError
> = {
  rate_limit: (args, msg) =>
    new RateLimitError(`Vertex quota exhausted: ${msg}`, {
      metadata: vertexMetadata(args, "rate_limit"),
    }),
  auth_unauthenticated: (args, msg) =>
    new AuthenticationError(`Vertex unauthenticated: ${msg}`, {
      metadata: vertexMetadata(args, "auth_failed"),
    }),
  auth_permission: (args, msg) =>
    new AuthenticationError(`Vertex permission denied: ${msg}`, {
      metadata: vertexMetadata(args, "auth_failed"),
    }),
  invalid_request: (args, msg) =>
    new ConfigurationError(`Vertex validation: ${msg}`, {
      metadata: vertexMetadata(args, "invalid_request"),
    }),
  timeout: (args, msg) =>
    new NetworkError(`Vertex timeout: ${msg}`, { metadata: vertexMetadata(args, "timeout") }),
  server_error: (args, msg) =>
    new NetworkError(`Vertex server error: ${msg}`, {
      metadata: vertexMetadata(args, "server_error"),
    }),
  unknown: (args, msg) =>
    new UnknownAgentError(`Vertex unknown: ${msg}`, { metadata: vertexMetadata(args, "unknown") }),
};

export function mapVertexError(args: MapVertexErrorArgs): TheokitAgentError {
  const parsed = parseBody(args.body);
  const errStatus = parsed.error?.status ?? "";
  const message = parsed.error?.message ?? "Vertex request failed";
  const code = classifyVertexError(args, errStatus);
  return VERTEX_ERROR_BUILDERS[code](args, message);
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
