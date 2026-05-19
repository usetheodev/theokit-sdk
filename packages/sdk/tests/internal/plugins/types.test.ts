/**
 * Tests for plugin types + definePlugin (T1.1, ADR D98).
 */

import { describe, expect, it } from "vitest";

import { definePlugin, type Plugin } from "../../../src/internal/plugins/types.js";

describe("definePlugin (T1.1)", () => {
  it("round-trips general kind", () => {
    const p = definePlugin({
      name: "p",
      version: "1.0.0",
      kind: "general",
      register: () => {},
    });
    expect(p.kind).toBe("general");
    expect(p.name).toBe("p");
  });

  it("typed model-provider shape", () => {
    const p = definePlugin({
      name: "anthropic-plugin",
      version: "1.0.0",
      kind: "model-provider",
      profile: {
        name: "anthropic",
        apiMode: "anthropic_messages",
        envVars: ["ANTHROPIC_API_KEY"],
        authType: "api_key",
        baseUrl: "https://api.anthropic.com",
        fallbackModels: ["claude-opus-4-7"],
      },
    });
    expect(p.kind).toBe("model-provider");
    if (p.kind === "model-provider") {
      expect(p.profile.name).toBe("anthropic");
    }
  });

  it("typed memory shape", () => {
    const p = definePlugin({
      name: "lance",
      version: "1.0.0",
      kind: "memory",
      createProvider: (_cwd: string) => ({}),
    });
    expect(p.kind).toBe("memory");
  });

  it("definePlugin is identity (no runtime transform)", () => {
    const input: Plugin = {
      name: "p",
      version: "1.0.0",
      kind: "general",
      register: () => {},
    };
    const out = definePlugin(input);
    expect(out).toBe(input);
  });
});
