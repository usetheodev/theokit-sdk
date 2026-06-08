/**
 * T3.7 — error-mapping completeness across the 3 provider mappers.
 *
 * Per DR3 finding #7, pre-T3.7 the OpenAI-compatible mapper folded HTTP 402
 * into `invalid_request` (with a TODO comment in `openai-compatible.ts:110`
 * acknowledging the miss). Anthropic 529 (overloaded) and Vertex 401/403 are
 * already mapped to the right ErrorCode buckets; this test pins all three
 * behaviors so future drift surfaces as a RED test.
 *
 * Mappings asserted:
 *  - OpenAI / OpenRouter 402 → `quota_exceeded` (NEW in T3.7).
 *  - Anthropic 529           → `server_error` (existing, pinned).
 *  - Vertex 401              → `auth_failed`  (via auth_unauthenticated).
 *  - Vertex 403              → `auth_failed`  (via auth_permission).
 */

import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  NetworkError,
  type TheokitAgentError,
} from "../../../../src/errors.js";
import { mapAnthropicError } from "../../../../src/internal/errors/mappers/anthropic.js";
import { mapOpenAICompatibleError } from "../../../../src/internal/errors/mappers/openai-compatible.js";
import { mapVertexError } from "../../../../src/internal/errors/mappers/vertex.js";

function emptyHeaders(): Headers {
  return new Headers();
}

describe("T3.7 — OpenAI-compatible 402 → quota_exceeded", () => {
  it("HTTP 402 maps to metadata.code === 'quota_exceeded'", () => {
    const err = mapOpenAICompatibleError({
      providerId: "openrouter",
      endpoint: "/v1/chat/completions",
      status: 402,
      headers: emptyHeaders(),
      body: { error: { message: "Insufficient credits" } },
    }) as TheokitAgentError;
    expect(err.metadata?.code).toBe("quota_exceeded");
  });

  it("body code `insufficient_quota` also maps to quota_exceeded", () => {
    const err = mapOpenAICompatibleError({
      providerId: "openai",
      endpoint: "/v1/chat/completions",
      status: 429,
      headers: emptyHeaders(),
      body: { error: { message: "quota exhausted", code: "insufficient_quota" } },
    }) as TheokitAgentError;
    expect(err.metadata?.code).toBe("quota_exceeded");
  });
});

describe("T3.7 — Anthropic 529 → server_error", () => {
  it("HTTP 529 (overloaded) maps to NetworkError with metadata server_error", () => {
    const err = mapAnthropicError({
      endpoint: "/v1/messages",
      status: 529,
      headers: emptyHeaders(),
      body: { type: "error", error: { type: "overloaded_error", message: "Service overloaded." } },
    });
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as TheokitAgentError).metadata?.code).toBe("server_error");
  });
});

describe("T3.7 — Vertex 401/403 → auth_failed", () => {
  it("HTTP 401 surfaces AuthenticationError with metadata auth_failed", () => {
    const err = mapVertexError({
      endpoint: "/v1/projects/p/locations/l/publishers/anthropic/models/m:rawPredict",
      status: 401,
      headers: emptyHeaders(),
      body: { error: { status: "UNAUTHENTICATED", message: "Invalid credentials" } },
    });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as TheokitAgentError).metadata?.code).toBe("auth_failed");
  });

  it("HTTP 403 surfaces AuthenticationError with metadata auth_failed", () => {
    const err = mapVertexError({
      endpoint: "/v1/projects/p/locations/l/publishers/anthropic/models/m:rawPredict",
      status: 403,
      headers: emptyHeaders(),
      body: { error: { status: "PERMISSION_DENIED", message: "Permission denied" } },
    });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as TheokitAgentError).metadata?.code).toBe("auth_failed");
  });
});
