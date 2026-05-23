/**
 * Tests for mapBedrockError — 5 canonical codes + fallback.
 */

import { describe, expect, it } from "vitest";
import { mapBedrockError } from "../../src/internal/errors/mappers/bedrock.js";
import {
  AuthenticationError,
  ConfigurationError,
  NetworkError,
  RateLimitError,
  UnknownAgentError,
} from "../../src/errors.js";

describe("mapBedrockError", () => {
  it("429 maps to RateLimitError", () => {
    const err = mapBedrockError({
      status: 429,
      body: { __type: "ThrottlingException", message: "too many" },
      headers: new Headers(),
      endpoint: "/model/foo/invoke",
    });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.metadata?.code).toBe("rate_limit");
  });

  it("ThrottlingException with 400 still maps to RateLimitError", () => {
    const err = mapBedrockError({
      status: 400,
      body: { __type: "ThrottlingException", message: "burst" },
      headers: new Headers(),
      endpoint: "/model/foo/invoke",
    });
    expect(err).toBeInstanceOf(RateLimitError);
  });

  it("401 with AccessDeniedException maps to AuthenticationError", () => {
    const err = mapBedrockError({
      status: 401,
      body: { __type: "AccessDeniedException", message: "no perms" },
      headers: new Headers(),
      endpoint: "/model/foo/invoke",
    });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.metadata?.code).toBe("auth_failed");
  });

  it("400 ValidationException maps to ConfigurationError", () => {
    const err = mapBedrockError({
      status: 400,
      body: { __type: "ValidationException", message: "bad arg" },
      headers: new Headers(),
      endpoint: "/model/foo/invoke",
    });
    expect(err).toBeInstanceOf(ConfigurationError);
    expect(err.metadata?.code).toBe("invalid_request");
  });

  it("500 maps to NetworkError with server_error code", () => {
    const err = mapBedrockError({
      status: 500,
      body: { __type: "InternalServerException", message: "oops" },
      headers: new Headers(),
      endpoint: "/model/foo/invoke",
    });
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.metadata?.code).toBe("server_error");
  });

  it("invalid JSON body falls through to UnknownAgentError", () => {
    const err = mapBedrockError({
      status: 418,
      body: "<html>I'm a teapot</html>",
      headers: new Headers(),
      endpoint: "/model/foo/invoke",
    });
    expect(err).toBeInstanceOf(UnknownAgentError);
  });

  it("metadata carries provider=bedrock + endpoint", () => {
    const err = mapBedrockError({
      status: 429,
      body: { __type: "ThrottlingException", message: "x" },
      headers: new Headers(),
      endpoint: "/model/foo/invoke",
    });
    expect(err.metadata?.provider).toBe("bedrock");
    expect(err.metadata?.endpoint).toBe("/model/foo/invoke");
  });
});
