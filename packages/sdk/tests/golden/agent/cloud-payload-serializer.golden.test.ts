import { describe, expect, it, vi } from "vitest";

import type { AgentOptions } from "../../../src/index.js";
import {
  canonicalize,
  serializeCloudAgentConfig,
  stringifyCloudPayload,
} from "../../../src/internal/runtime/cloud-config-serializer.js";

/**
 * ADR D15 + EC-1/EC-2/EC-7 — pure JSON serializer with deterministic
 * key-order, per-feature allow-list (secrets stripped), and size guardrail.
 */

const REPOS = [{ url: "https://github.com/usetheo/example" }];
const MODEL = { id: "google/gemini-2.0-flash-001" };

function minimal(): AgentOptions {
  return {
    apiKey: "redacted-should-not-cross",
    model: MODEL,
    cloud: { repos: REPOS },
  };
}

describe("serializeCloudAgentConfig — shape", () => {
  it("minimal cloud payload has schemaVersion + cloud + model only", () => {
    const out = serializeCloudAgentConfig(minimal());
    expect(out.schemaVersion).toBe("1.0");
    expect(out.cloud.repos).toEqual([{ url: REPOS[0]!.url }]);
    expect(out.model).toEqual({ id: MODEL.id });
    // Default-undefined optional fields are absent
    expect(out.skills).toBeUndefined();
    expect(out.plugins).toBeUndefined();
    expect(out.mcpServers).toBeUndefined();
    expect(out.agents).toBeUndefined();
    expect(out.providers).toBeUndefined();
    expect(out.memory).toBeUndefined();
  });

  it("serializes skills.enabled when non-empty", () => {
    const out = serializeCloudAgentConfig({
      ...minimal(),
      skills: { enabled: ["deploy", "review"] },
    });
    expect(out.skills).toEqual({ enabled: ["deploy", "review"] });
  });

  it("omits skills when enabled is empty array", () => {
    const out = serializeCloudAgentConfig({ ...minimal(), skills: { enabled: [] } });
    expect(out.skills).toBeUndefined();
  });

  it("serializes plugins.enabled when non-empty", () => {
    const out = serializeCloudAgentConfig({
      ...minimal(),
      plugins: { enabled: ["my-plugin"] },
    });
    expect(out.plugins).toEqual({ enabled: ["my-plugin"] });
  });

  it("serializes HTTP MCP server", () => {
    const out = serializeCloudAgentConfig({
      ...minimal(),
      mcpServers: { search: { type: "http", url: "https://mcp.example.com" } },
    });
    expect(out.mcpServers).toEqual({ search: { type: "http", url: "https://mcp.example.com" } });
  });

  it("serializes stdio MCP server with args", () => {
    const out = serializeCloudAgentConfig({
      ...minimal(),
      mcpServers: { x: { type: "stdio", command: "npx", args: ["-y", "@scope/mcp"] } },
    });
    expect(out.mcpServers).toEqual({
      x: { type: "stdio", command: "npx", args: ["-y", "@scope/mcp"] },
    });
  });

  it("serializes subagents", () => {
    const out = serializeCloudAgentConfig({
      ...minimal(),
      agents: {
        reviewer: { description: "Reviews PRs", prompt: "Be helpful", model: MODEL },
      },
    });
    expect(out.agents).toEqual({
      reviewer: {
        description: "Reviews PRs",
        systemPrompt: "Be helpful",
        model: { id: MODEL.id },
      },
    });
  });

  it("serializes providers.routes (without weight field — not in public type)", () => {
    const out = serializeCloudAgentConfig({
      ...minimal(),
      providers: {
        routes: [
          { capability: "chat", provider: "openai", model: "gpt-4o-mini" },
          { capability: "chat", provider: "anthropic" },
        ],
        fallback: ["openrouter"],
      },
    });
    expect(out.providers?.routes).toEqual([
      { provider: "openai", model: "gpt-4o-mini" },
      { provider: "anthropic" },
    ]);
    expect(out.providers?.fallback).toEqual(["openrouter"]);
  });

  it("serializes memory.index.embedding", () => {
    const out = serializeCloudAgentConfig({
      ...minimal(),
      memory: {
        enabled: true,
        index: {
          backend: "sqlite-vec",
          embedding: { provider: "openai", model: "text-embedding-3-small" },
        },
      },
    });
    expect(out.memory).toEqual({
      enabled: true,
      index: {
        backend: "sqlite-vec",
        embedding: { provider: "openai", model: "text-embedding-3-small" },
      },
    });
  });

  it("drops undefined optional fields (no `name: null` artifacts)", () => {
    const out = serializeCloudAgentConfig(minimal());
    expect(out).not.toHaveProperty("name");
    expect(out).not.toHaveProperty("agentId");
  });
});

describe("serializeCloudAgentConfig — determinism (EC-1)", () => {
  it("same input twice produces byte-identical JSON", () => {
    const opts = minimal();
    const a = stringifyCloudPayload(serializeCloudAgentConfig(opts));
    const b = stringifyCloudPayload(serializeCloudAgentConfig(opts));
    expect(a).toBe(b);
  });

  it("key order in input is independent of output (EC-1: canonical sort)", () => {
    const optsA: AgentOptions = {
      apiKey: "test",
      model: MODEL,
      cloud: { repos: REPOS },
      systemPrompt: "alpha",
      skills: { enabled: ["a", "b"] },
    };
    const optsB: AgentOptions = {
      skills: { enabled: ["a", "b"] },
      systemPrompt: "alpha",
      apiKey: "test",
      cloud: { repos: REPOS },
      model: MODEL,
    };
    const a = stringifyCloudPayload(serializeCloudAgentConfig(optsA));
    const b = stringifyCloudPayload(serializeCloudAgentConfig(optsB));
    expect(a).toBe(b);
  });

  it("canonicalize sorts nested object keys recursively", () => {
    const result = canonicalize({ z: 1, a: { y: 2, b: 3 } });
    expect(JSON.stringify(result)).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it("canonicalize preserves array order", () => {
    const result = canonicalize([{ z: 1, a: 2 }, "x", 1]);
    expect(JSON.stringify(result)).toBe('[{"a":2,"z":1},"x",1]');
  });
});

describe("serializeCloudAgentConfig — secrets stripped (EC-2)", () => {
  it("top-level apiKey never appears in JSON output", () => {
    const out = serializeCloudAgentConfig({
      apiKey: "sk-real-token-do-not-leak",
      model: MODEL,
      cloud: { repos: REPOS },
    });
    const json = stringifyCloudPayload(out);
    expect(json).not.toContain("sk-real-token-do-not-leak");
    expect(json).not.toContain("apiKey");
  });

  it("HTTP MCP headers never cross (Authorization, x-api-key)", () => {
    const opts = {
      apiKey: "test",
      model: MODEL,
      cloud: { repos: REPOS },
      mcpServers: {
        search: {
          type: "http",
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer real-token", "x-api-key": "real-key" },
        },
      },
    } as unknown as AgentOptions;
    const out = serializeCloudAgentConfig(opts);
    const json = stringifyCloudPayload(out);
    expect(json).not.toContain("real-token");
    expect(json).not.toContain("real-key");
    expect(json).not.toContain("Authorization");
    // The url and type DO cross
    expect(json).toContain("https://mcp.example.com");
  });

  it("stdio MCP env never crosses (EC-2)", () => {
    const opts = {
      apiKey: "test",
      model: MODEL,
      cloud: { repos: REPOS },
      mcpServers: {
        x: {
          type: "stdio",
          command: "node",
          args: ["server.js"],
          env: { TOKEN: "real-secret-token" },
        },
      },
    } as unknown as AgentOptions;
    const out = serializeCloudAgentConfig(opts);
    const json = stringifyCloudPayload(out);
    expect(json).not.toContain("real-secret-token");
    expect(json).not.toContain("TOKEN");
    expect(json).not.toContain('"env"');
  });

  it("memory embedding apiKey/credentials never cross", () => {
    const opts = {
      apiKey: "test",
      model: MODEL,
      cloud: { repos: REPOS },
      memory: {
        enabled: true,
        index: {
          backend: "sqlite-vec",
          embedding: {
            provider: "openai",
            model: "text-embedding-3-small",
            apiKey: "sk-embedding-real",
          },
        },
      },
    } as unknown as AgentOptions;
    const out = serializeCloudAgentConfig(opts);
    const json = stringifyCloudPayload(out);
    expect(json).not.toContain("sk-embedding-real");
    expect(json).not.toContain('"apiKey"');
  });
});

describe("serializeCloudAgentConfig — payload size guardrail (EC-7)", () => {
  it("warns to stderr when payload exceeds 1 MB", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const big = "x".repeat(50_000);
    const agents: NonNullable<AgentOptions["agents"]> = {};
    for (let i = 0; i < 30; i++) {
      agents[`subagent-${i}`] = { description: big, prompt: big };
    }
    const out = serializeCloudAgentConfig({
      apiKey: "test",
      model: MODEL,
      cloud: { repos: REPOS },
      agents,
    });
    const json = stringifyCloudPayload(out);

    expect(Buffer.byteLength(json, "utf8")).toBeGreaterThan(1_048_576);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("PaaS may reject"));
    stderrSpy.mockRestore();
  });

  it("does NOT warn when payload is well under 1 MB", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stringifyCloudPayload(serializeCloudAgentConfig(minimal()));
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});
