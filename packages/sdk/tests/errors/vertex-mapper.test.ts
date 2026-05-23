/**
 * Tests for mapVertexError — 5 canonical codes + fallback.
 */

import { describe, expect, it } from "vitest";
import { mapVertexError } from "../../src/internal/errors/mappers/vertex.js";
import {
  AuthenticationError,
  ConfigurationError,
  NetworkError,
  RateLimitError,
  UnknownAgentError,
} from "../../src/errors.js";

describe("mapVertexError", () => {
  it("429 maps to RateLimitError", () => {
    const err = mapVertexError({
      status: 429,
      body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota" } },
      headers: new Headers(),
      endpoint: ":rawPredict",
    });
    expect(err).toBeInstanceOf(RateLimitError);
  });

  it("RESOURCE_EXHAUSTED with 400 still maps to RateLimitError", () => {
    const err = mapVertexError({
      status: 400,
      body: { error: { status: "RESOURCE_EXHAUSTED", message: "tpm" } },
      headers: new Headers(),
      endpoint: ":rawPredict",
    });
    expect(err).toBeInstanceOf(RateLimitError);
  });

  it("401 UNAUTHENTICATED maps to AuthenticationError", () => {
    const err = mapVertexError({
      status: 401,
      body: { error: { code: 401, status: "UNAUTHENTICATED", message: "bad token" } },
      headers: new Headers(),
      endpoint: ":rawPredict",
    });
    expect(err).toBeInstanceOf(AuthenticationError);
  });

  it("403 PERMISSION_DENIED maps to AuthenticationError", () => {
    const err = mapVertexError({
      status: 403,
      body: { error: { code: 403, status: "PERMISSION_DENIED", message: "iam" } },
      headers: new Headers(),
      endpoint: ":rawPredict",
    });
    expect(err).toBeInstanceOf(AuthenticationError);
  });

  it("400 INVALID_ARGUMENT maps to ConfigurationError", () => {
    const err = mapVertexError({
      status: 400,
      body: { error: { code: 400, status: "INVALID_ARGUMENT", message: "bad project" } },
      headers: new Headers(),
      endpoint: ":rawPredict",
    });
    expect(err).toBeInstanceOf(ConfigurationError);
  });

  it("500 maps to NetworkError with server_error code", () => {
    const err = mapVertexError({
      status: 500,
      body: { error: { code: 500, status: "INTERNAL", message: "oops" } },
      headers: new Headers(),
      endpoint: ":rawPredict",
    });
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.metadata?.code).toBe("server_error");
  });

  it("metadata carries provider=vertex + endpoint", () => {
    const err = mapVertexError({
      status: 429,
      body: { error: { status: "RESOURCE_EXHAUSTED", message: "x" } },
      headers: new Headers(),
      endpoint: ":rawPredict",
    });
    expect(err.metadata?.provider).toBe("vertex");
    expect(err.metadata?.endpoint).toBe(":rawPredict");
  });

  it("unknown status falls through to UnknownAgentError", () => {
    const err = mapVertexError({
      status: 418,
      body: "teapot",
      headers: new Headers(),
      endpoint: ":rawPredict",
    });
    expect(err).toBeInstanceOf(UnknownAgentError);
  });
});
