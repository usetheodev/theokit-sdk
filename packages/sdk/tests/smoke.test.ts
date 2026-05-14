import { describe, expect, it } from "vitest";

import {
  Agent,
  AuthenticationError,
  ConfigurationError,
  Cron,
  IntegrationNotConnectedError,
  NetworkError,
  RateLimitError,
  Theokit,
  TheokitAgentError,
  UnknownAgentError,
  UnsupportedRunOperationError,
} from "../src/index.js";

describe("@usetheo/sdk public surface", () => {
  it("exports Agent, Cron, and Theokit façades", () => {
    expect(typeof Agent.create).toBe("function");
    expect(typeof Agent.prompt).toBe("function");
    expect(typeof Cron.create).toBe("function");
    expect(typeof Cron.start).toBe("function");
    expect(typeof Theokit.models.list).toBe("function");
    expect(typeof Theokit.repositories.list).toBe("function");
  });
});

describe("error class hierarchy", () => {
  it("TheokitAgentError carries isRetryable, code, protoErrorCode, and cause", () => {
    const cause = new Error("upstream");
    const err = new TheokitAgentError("boom", {
      isRetryable: true,
      code: "BOOM_001",
      protoErrorCode: "proto/boom",
      cause,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TheokitAgentError);
    expect(err.name).toBe("TheokitAgentError");
    expect(err.message).toBe("boom");
    expect(err.isRetryable).toBe(true);
    expect(err.code).toBe("BOOM_001");
    expect(err.protoErrorCode).toBe("proto/boom");
    expect(err.cause).toBe(cause);
  });

  it("TheokitAgentError defaults isRetryable to false", () => {
    const err = new TheokitAgentError("oops");
    expect(err.isRetryable).toBe(false);
  });

  it("subclasses extend TheokitAgentError", () => {
    expect(new AuthenticationError("nope")).toBeInstanceOf(TheokitAgentError);
    expect(new RateLimitError("slow")).toBeInstanceOf(TheokitAgentError);
    expect(new ConfigurationError("bad")).toBeInstanceOf(TheokitAgentError);
    expect(new NetworkError("timeout")).toBeInstanceOf(TheokitAgentError);
    expect(new UnknownAgentError("?")).toBeInstanceOf(TheokitAgentError);
  });

  it("subclasses set isRetryable per contract", () => {
    expect(new AuthenticationError("nope").isRetryable).toBe(false);
    expect(new RateLimitError("slow").isRetryable).toBe(true);
    expect(new ConfigurationError("bad").isRetryable).toBe(false);
    expect(new NetworkError("timeout").isRetryable).toBe(true);
    expect(new UnknownAgentError("?").isRetryable).toBe(false);
  });

  it("IntegrationNotConnectedError carries provider and helpUrl", () => {
    const err = new IntegrationNotConnectedError("not connected", {
      provider: "github",
      helpUrl: "https://example.com/connect/github",
    });
    expect(err).toBeInstanceOf(ConfigurationError);
    expect(err).toBeInstanceOf(TheokitAgentError);
    expect(err.provider).toBe("github");
    expect(err.helpUrl).toBe("https://example.com/connect/github");
  });

  it("UnsupportedRunOperationError carries the operation", () => {
    const err = new UnsupportedRunOperationError("not supported here", "stream");
    expect(err.operation).toBe("stream");
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TheokitAgentError);
  });
});
