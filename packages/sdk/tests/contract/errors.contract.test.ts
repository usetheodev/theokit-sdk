import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  ConfigurationError,
  IntegrationNotConnectedError,
  NetworkError,
  RateLimitError,
  TheokitAgentError,
  UnknownAgentError,
  UnsupportedRunOperationError,
} from "../../src/index.js";
import authenticationGolden from "../golden/errors/authentication-error.json";
import configurationGolden from "../golden/errors/configuration-error.json";
import integrationGolden from "../golden/errors/integration-not-connected-error.json";
import rateLimitGolden from "../golden/errors/rate-limit-error.json";
import unsupportedGolden from "../golden/errors/unsupported-run-operation-error.json";
import { expectPublicError } from "../helpers/assert-public-error.js";
import { normalizeForGolden } from "../helpers/normalize.js";

describe("public error contract", () => {
  it("normalizes public error shapes to golden files", () => {
    const auth = new AuthenticationError("Invalid API key", {
      code: "authentication_error",
      protoErrorCode: "AUTHENTICATION_ERROR",
    } as never);
    const rateLimit = new RateLimitError("Rate limit exceeded", {
      code: "rate_limit_error",
      protoErrorCode: "RATE_LIMIT_ERROR",
    } as never);
    const config = new ConfigurationError("Invalid configuration", { code: "configuration_error" });
    const integration = new IntegrationNotConnectedError("GitHub integration is not connected", {
      provider: "github",
      helpUrl: "https://usetheo.com/docs/integrations/github",
      code: "integration_not_connected",
    });
    const unsupported = new UnsupportedRunOperationError(
      "Operation stream is not supported for this run",
      "stream",
    );

    expect(normalizeForGolden(auth)).toEqual(authenticationGolden);
    expect(normalizeForGolden(rateLimit)).toEqual(rateLimitGolden);
    expect(normalizeForGolden(config)).toEqual(configurationGolden);
    expect(normalizeForGolden(integration)).toEqual(integrationGolden);
    expect(normalizeForGolden(unsupported)).toEqual(unsupportedGolden);
  });

  it("all public SDK errors carry typed retry and code metadata", () => {
    const cause = new Error("transport");

    expectPublicError(
      new AuthenticationError("Invalid API key", { code: "authentication_error", cause }),
      {
        ctor: AuthenticationError,
        name: "AuthenticationError",
        code: "authentication_error",
        isRetryable: false,
        cause,
      },
    );
    expectPublicError(new RateLimitError("Too many requests", { code: "rate_limit_error" }), {
      ctor: RateLimitError,
      name: "RateLimitError",
      code: "rate_limit_error",
      isRetryable: true,
    });
    expectPublicError(new NetworkError("Timeout", { code: "network_error" }), {
      ctor: NetworkError,
      name: "NetworkError",
      code: "network_error",
      isRetryable: true,
    });
    expectPublicError(new UnknownAgentError("Unknown", { code: "unknown_agent_error" }), {
      ctor: UnknownAgentError,
      name: "UnknownAgentError",
      code: "unknown_agent_error",
      isRetryable: false,
    });
    expect(new UnsupportedRunOperationError("No stream", "stream")).toBeInstanceOf(
      TheokitAgentError,
    );
  });
});
