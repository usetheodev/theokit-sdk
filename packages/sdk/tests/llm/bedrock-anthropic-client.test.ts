/**
 * Tests for BedrockAnthropicClient — body massage, URL, error mapping,
 * D302 non-streaming, EC-6 helpful error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BedrockAnthropicClient } from "../../src/internal/llm/bedrock-anthropic.js";
import { __resetBedrockTokenCache } from "../../src/internal/llm/bedrock-token-cache.js";
import { AuthenticationError, ConfigurationError, RateLimitError } from "../../src/errors.js";
import type { LlmRequest } from "../../src/internal/llm/types.js";

const REQ: LlmRequest = {
  model: "bedrock/us.anthropic.claude-sonnet-4-5-v1:0",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env = { ...originalEnv };
  __resetBedrockTokenCache();
});
afterEach(() => {
  process.env = originalEnv;
});

function mockFetch(response: Partial<Response> & { body: unknown; status?: number }): typeof fetch {
  return (async (_url: unknown, _init: unknown) => {
    const init = _init as RequestInit;
    void init;
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
      headers: new Headers(),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("BedrockAnthropicClient — body massage", () => {
  it("strips bedrock/ prefix from URL and includes raw model id", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "tok123";
    let capturedUrl = "";
    const fetchImpl = (async (url: string) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: "text", text: "hello" }], stop_reason: "end_turn" }),
        text: async () => "",
        headers: new Headers(),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = new BedrockAnthropicClient({ fetch: fetchImpl });
    const iter = client.stream(REQ, new AbortController().signal);
    for await (const _ of iter) {
      void _;
    }
    expect(capturedUrl).toContain("us.anthropic.claude-sonnet-4-5-v1%3A0");
    expect(capturedUrl).not.toContain("bedrock/");
    expect(capturedUrl).toContain("us-east-1");
  });

  it("D289: injects anthropic_version bedrock-2023-05-31 and strips model from body", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "tok123";
    let capturedBody = "";
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [], stop_reason: "end_turn" }),
        text: async () => "",
        headers: new Headers(),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = new BedrockAnthropicClient({ fetch: fetchImpl });
    const iter = client.stream(REQ, new AbortController().signal);
    for await (const _ of iter) {
      void _;
    }
    const body = JSON.parse(capturedBody) as { anthropic_version: string; model?: string };
    expect(body.anthropic_version).toBe("bedrock-2023-05-31");
    expect(body.model).toBeUndefined();
  });

  it("D302: always uses /invoke (no streaming endpoint in v1)", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "tok123";
    let capturedUrl = "";
    const fetchImpl = (async (url: string) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [], stop_reason: "end_turn" }),
        text: async () => "",
        headers: new Headers(),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = new BedrockAnthropicClient({ fetch: fetchImpl });
    const iter = client.stream(REQ, new AbortController().signal);
    for await (const _ of iter) {
      void _;
    }
    expect(capturedUrl.endsWith("/invoke")).toBe(true);
    expect(capturedUrl).not.toContain("invoke-with-response-stream");
  });

  it("sends Authorization: Bearer header", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "tok-secret";
    let capturedHeaders: HeadersInit | undefined;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [], stop_reason: "end_turn" }),
        text: async () => "",
        headers: new Headers(),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = new BedrockAnthropicClient({ fetch: fetchImpl });
    const iter = client.stream(REQ, new AbortController().signal);
    for await (const _ of iter) {
      void _;
    }
    const headers = capturedHeaders as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok-secret");
  });
});

describe("BedrockAnthropicClient — helpful errors", () => {
  it("EC-6: throws ConfigurationError when no token resolvable", async () => {
    // env not set + peer dep missing → throws helpful error.
    const client = new BedrockAnthropicClient({});
    const iter = client.stream(REQ, new AbortController().signal);
    await expect(iter.next()).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("EC-9: uses caller-provided apiKey over env", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "env-token";
    let capturedAuth = "";
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      capturedAuth = (init.headers as Record<string, string>).authorization;
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [], stop_reason: "end_turn" }),
        text: async () => "",
        headers: new Headers(),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = new BedrockAnthropicClient({ apiKey: "caller-token", fetch: fetchImpl });
    const iter = client.stream(REQ, new AbortController().signal);
    for await (const _ of iter) {
      void _;
    }
    expect(capturedAuth).toBe("Bearer caller-token");
  });
});

describe("BedrockAnthropicClient — error mapping (D300)", () => {
  it("429 maps to RateLimitError", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "tok";
    const fetchImpl = mockFetch({
      status: 429,
      body: { __type: "ThrottlingException", message: "too many" },
    });
    const client = new BedrockAnthropicClient({ fetch: fetchImpl });
    const iter = client.stream(REQ, new AbortController().signal);
    await expect(iter.next()).rejects.toBeInstanceOf(RateLimitError);
  });

  it("401 maps to AuthenticationError", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "tok";
    const fetchImpl = mockFetch({
      status: 401,
      body: { __type: "AccessDeniedException", message: "no perms" },
    });
    const client = new BedrockAnthropicClient({ fetch: fetchImpl });
    const iter = client.stream(REQ, new AbortController().signal);
    await expect(iter.next()).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("BedrockAnthropicClient — response parsing", () => {
  it("emits single text delta and returns LlmFinish", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "tok";
    const fetchImpl = mockFetch({
      status: 200,
      body: {
        content: [{ type: "text", text: "Brasília" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 2 },
      },
    });
    const client = new BedrockAnthropicClient({ fetch: fetchImpl });
    const iter = client.stream(REQ, new AbortController().signal);
    const events: unknown[] = [];
    let finish: unknown;
    while (true) {
      const result = await iter.next();
      if (result.done) {
        finish = result.value;
        break;
      }
      events.push(result.value);
    }
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string; text: string }).type).toBe("text_delta");
    expect((events[0] as { type: string; text: string }).text).toBe("Brasília");
    expect((finish as { text: string }).text).toBe("Brasília");
  });
});
