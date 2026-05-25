/**
 * Tests for VertexAnthropicClient — body massage, URL, EC-1/EC-3 errors.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigurationError } from "../../src/errors.js";
import type { LlmRequest } from "../../src/internal/llm/types.js";
import { VertexAnthropicClient } from "../../src/internal/llm/vertex-anthropic.js";
import {
  __resetVertexAuth,
  __setVertexAuthClientForTests,
} from "../../src/internal/llm/vertex-auth.js";

const REQ: LlmRequest = {
  model: "vertex/anthropic/claude-sonnet-4-5@20250929",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env = { ...originalEnv };
  __resetVertexAuth();
});
afterEach(() => {
  process.env = originalEnv;
  __resetVertexAuth();
});

describe("VertexAnthropicClient — body massage (D292)", () => {
  it("injects anthropic_version vertex-2023-10-16 and strips model", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "proj-1";
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
    __setVertexAuthClientForTests({
      getAccessToken: async () => ({ token: "vt-token" }),
    });

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

    const client = new VertexAnthropicClient({ fetch: fetchImpl });
    const iter = client.stream(REQ, new AbortController().signal);
    for await (const _ of iter) {
      void _;
    }
    const body = JSON.parse(capturedBody) as { anthropic_version: string; model?: string };
    expect(body.anthropic_version).toBe("vertex-2023-10-16");
    expect(body.model).toBeUndefined();
  });

  it("EC-4: encodes @ in model id correctly", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "proj-1";
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
    __setVertexAuthClientForTests({
      getAccessToken: async () => ({ token: "vt-token" }),
    });

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

    const client = new VertexAnthropicClient({ fetch: fetchImpl });
    const iter = client.stream(REQ, new AbortController().signal);
    for await (const _ of iter) {
      void _;
    }
    expect(capturedUrl).toContain("claude-sonnet-4-5%4020250929");
    expect(capturedUrl.endsWith(":rawPredict")).toBe(true);
  });

  it("D293: global location strips region prefix from baseUrl", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "proj-1";
    process.env.GOOGLE_CLOUD_LOCATION = "global";
    __setVertexAuthClientForTests({
      getAccessToken: async () => ({ token: "vt-token" }),
    });

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

    const client = new VertexAnthropicClient({ fetch: fetchImpl });
    const iter = client.stream(REQ, new AbortController().signal);
    for await (const _ of iter) {
      void _;
    }
    expect(capturedUrl).toContain("https://aiplatform.googleapis.com");
    expect(capturedUrl).not.toContain("global-aiplatform");
  });
});

describe("VertexAnthropicClient — helpful errors", () => {
  it("EC-1: throws ConfigurationError when projectId missing", async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT_ID;
    delete process.env.GCLOUD_PROJECT;

    const client = new VertexAnthropicClient({});
    const iter = client.stream(REQ, new AbortController().signal);
    await expect(iter.next()).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("throws ConfigurationError when access token unresolvable", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "proj-1";
    __setVertexAuthClientForTests({
      getAccessToken: async () => ({ token: null }),
    });
    const client = new VertexAnthropicClient({});
    const iter = client.stream(REQ, new AbortController().signal);
    await expect(iter.next()).rejects.toBeInstanceOf(ConfigurationError);
  });
});
