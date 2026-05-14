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
    expect(Agent).toBeDefined();
    expect(Cron).toBeDefined();
    expect(Theokit).toBeDefined();
  });

  it("Agent static methods reject with ConfigurationError until implemented", async () => {
    await expect(Agent.create({})).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Agent.prompt("hi", {})).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Agent.resume("agent-x")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Agent.list()).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Agent.get("agent-x")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Agent.listRuns("agent-x")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Agent.getRun("run-x")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Agent.archive("agent-x")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Agent.unarchive("agent-x")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Agent.delete("agent-x")).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("Theokit namespace methods reject with ConfigurationError until implemented", async () => {
    await expect(Theokit.me()).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Theokit.models.list()).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Theokit.repositories.list()).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("Cron namespace methods reject with ConfigurationError until implemented", async () => {
    await expect(Cron.create({ cron: "0 9 * * *", message: "hi" })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    await expect(Cron.list()).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Cron.get("cron-x")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Cron.delete("cron-x")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Cron.enable("cron-x")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Cron.disable("cron-x")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Cron.run("cron-x")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Cron.start()).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Cron.stop()).rejects.toBeInstanceOf(ConfigurationError);
    await expect(Cron.status()).rejects.toBeInstanceOf(ConfigurationError);
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
