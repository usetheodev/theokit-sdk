import { describe, expect, it } from "vitest";

import { Provider } from "../src/define-provider.js";

/**
 * M43 — `Provider.builtins()` exposes every registered builtin provider as a model-provider plugin, so a
 * runtime that does NOT share the SDK's provider registry (the `theokit` agent server / `@theokit/agents`,
 * which resolve models via their own `buildModelSelection`) can still route to any SDK builtin — including
 * `openai-chatgpt` — with zero provider-specific code.
 */
describe("Provider.builtins()", () => {
  it("returns model-provider plugins including the openai-chatgpt Codex builtin", () => {
    const plugins = Provider.builtins();
    expect(plugins.length).toBeGreaterThan(0);
    for (const p of plugins) expect(p.kind).toBe("model-provider");
    const names = plugins.map((p) => p.name);
    expect(names).toContain("openai-chatgpt");
    expect(names).toContain("openai");
    expect(names).toContain("anthropic");
  });

  it("each plugin carries the full ProviderProfile (transport + transform survive injection)", () => {
    const codex = Provider.builtins().find((p) => p.name === "openai-chatgpt");
    expect(codex).toBeDefined();
    const profile = (codex as unknown as { profile: { apiMode: string; transform?: unknown } })
      .profile;
    expect(profile.apiMode).toBe("responses_api");
    expect(profile.transform).toBeDefined(); // the auth seam rides along into the consuming runtime
  });
});
