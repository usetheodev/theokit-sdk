import { afterEach, describe, expect, it } from "vitest";

import { Agent, Theokit } from "../../src/index.js";
import { type LocalHttpServer, startLocalHttpServer } from "../helpers/local-http-server.js";

describe("cloud HTTP protocol contract", () => {
  let server: LocalHttpServer | undefined;
  let previousBaseUrl: string | undefined;

  afterEach(async () => {
    if (previousBaseUrl === undefined) {
      delete process.env.THEOKIT_API_BASE_URL;
    } else {
      process.env.THEOKIT_API_BASE_URL = previousBaseUrl;
    }
    previousBaseUrl = undefined;
    await server?.close();
    server = undefined;
  });

  it("uses real HTTP requests for cloud Agent.create and parses the SDKAgent response", async () => {
    server = await startLocalHttpServer((request, response) => {
      if (request.method === "POST" && request.url === "/v1/agents") {
        response.writeHead(201, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            agentId: "bc-00000000-0000-4000-8000-000000000001",
            model: { id: "google/gemini-2.0-flash-001" },
          }),
        );
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "not_found", message: "not found" } }));
    });
    previousBaseUrl = process.env.THEOKIT_API_BASE_URL;
    process.env.THEOKIT_API_BASE_URL = server.url;

    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-001" },
      cloud: {
        repos: [{ url: "https://github.com/usetheo/example", startingRef: "main" }],
        autoCreatePR: true,
        envVars: { STAGING_TOKEN: "secret-value" },
      },
    });

    expect(agent).toMatchObject({
      agentId: "bc-00000000-0000-4000-8000-000000000001",
      model: { id: "google/gemini-2.0-flash-001" },
      send: expect.any(Function),
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method: "POST",
      url: "/v1/agents",
      headers: expect.objectContaining({
        authorization: "Bearer theo_test_contract_key",
      }),
      body: expect.objectContaining({
        model: { id: "google/gemini-2.0-flash-001" },
        cloud: expect.objectContaining({
          autoCreatePR: true,
          repos: [{ url: "https://github.com/usetheo/example", startingRef: "main" }],
          envVars: { STAGING_TOKEN: "secret-value" },
        }),
      }),
    });
    expect(JSON.stringify(server.requests)).not.toContain("THEOKIT_");
  });

  it("maps HTTP error envelopes to public typed errors", async () => {
    server = await startLocalHttpServer((_request, response) => {
      response.writeHead(429, {
        "content-type": "application/json",
        "x-request-id": "request-123",
      });
      response.end(
        JSON.stringify({
          error: {
            code: "rate_limit_error",
            protoErrorCode: "RATE_LIMIT_ERROR",
            message: "Rate limit exceeded",
          },
        }),
      );
    });
    previousBaseUrl = process.env.THEOKIT_API_BASE_URL;
    process.env.THEOKIT_API_BASE_URL = server.url;

    await expect(Theokit.models.list({ apiKey: "theo_test_contract_key" })).rejects.toMatchObject({
      name: "RateLimitError",
      message: "Rate limit exceeded",
      code: "rate_limit_error",
      protoErrorCode: "RATE_LIMIT_ERROR",
      isRetryable: true,
    });
    expect(server.requests).toHaveLength(1);
  });
});
