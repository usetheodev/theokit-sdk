/**
 * Tests for Ollama-specific HTTP/transport error mapping (T1.1, ADR D185).
 *
 * Covers:
 * - ECONNREFUSED (ollama serve not running) → ollama_unreachable + actionable message
 * - 404 with "model not found, try pulling it first" → ollama_model_not_pulled
 * - 503 with "model is loading" → ollama_model_loading (retryable)
 * - Other errors → falls through (returns undefined, caller uses generic mapper)
 */

import { describe, expect, it } from "vitest";

import { ConfigurationError, NetworkError } from "../../../src/errors.js";
import {
  mapOllamaHttpError,
  mapOllamaTransportError,
} from "../../../src/internal/error-mappers/ollama.js";
import { expectPublicError } from "../../helpers/assert-public-error.js";

function headers(record: Record<string, string> = {}): Headers {
  return new Headers(record);
}

describe("mapOllamaTransportError — fetch-level failures (T1.1)", () => {
  it("ECONNREFUSED → ConfigurationError ollama_unreachable + actionable message", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), {
      code: "ECONNREFUSED",
    });
    const fetchErr = Object.assign(new TypeError("fetch failed"), { cause });

    const err = mapOllamaTransportError({
      providerId: "ollama",
      cause: fetchErr,
      endpoint: "/v1/chat/completions",
    });

    expectPublicError(err, {
      ctor: ConfigurationError,
      code: "ollama_unreachable",
      message: /ollama serve/i,
    });
  });

  it("ENOTFOUND (typo OLLAMA_HOST) → ConfigurationError ollama_unreachable", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND nonexistent"), {
      code: "ENOTFOUND",
    });
    const fetchErr = Object.assign(new TypeError("fetch failed"), { cause });

    const err = mapOllamaTransportError({
      providerId: "ollama",
      cause: fetchErr,
      endpoint: "/v1/chat/completions",
    });

    expectPublicError(err, {
      ctor: ConfigurationError,
      code: "ollama_unreachable",
    });
  });

  it("Other transport errors → undefined (fallthrough)", () => {
    const fetchErr = new TypeError("some other fetch failure");
    const err = mapOllamaTransportError({
      providerId: "ollama",
      cause: fetchErr,
      endpoint: "/v1/chat/completions",
    });
    expect(err).toBeUndefined();
  });

  it("Non-ollama provider → undefined (no special handling)", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const fetchErr = Object.assign(new TypeError("fetch failed"), { cause });

    const err = mapOllamaTransportError({
      providerId: "openai",
      cause: fetchErr,
      endpoint: "/v1/chat/completions",
    });
    expect(err).toBeUndefined();
  });
});

describe("mapOllamaHttpError — HTTP response failures (T1.1)", () => {
  it("404 + body 'model not found, try pulling' → ollama_model_not_pulled", () => {
    const err = mapOllamaHttpError({
      providerId: "ollama",
      status: 404,
      body: { error: "model 'llama3.2' not found, try pulling it first" },
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });

    expectPublicError(err, {
      ctor: ConfigurationError,
      code: "ollama_model_not_pulled",
      message: /ollama pull/i,
    });
  });

  it("503 + body 'model is loading' → ollama_model_loading (RETRYABLE)", () => {
    const err = mapOllamaHttpError({
      providerId: "ollama",
      status: 503,
      body: { error: "model is loading" },
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });

    expectPublicError(err, {
      ctor: NetworkError,
      code: "ollama_model_loading",
      isRetryable: true,
    });
  });

  it("Other Ollama HTTP errors → undefined (caller uses generic mapper)", () => {
    const err = mapOllamaHttpError({
      providerId: "ollama",
      status: 500,
      body: { error: "internal error" },
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    expect(err).toBeUndefined();
  });

  it("Non-ollama provider → undefined", () => {
    const err = mapOllamaHttpError({
      providerId: "openai",
      status: 404,
      body: { error: "model not found, try pulling" },
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    expect(err).toBeUndefined();
  });

  it("404 without 'pull' hint → undefined (generic 404, not Ollama-specific)", () => {
    const err = mapOllamaHttpError({
      providerId: "ollama",
      status: 404,
      body: { error: "endpoint not found" },
      headers: headers(),
      endpoint: "/v1/some-other-path",
    });
    expect(err).toBeUndefined();
  });
});
