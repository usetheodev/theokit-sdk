/**
 * Integration: a `kind: "model-provider"` plugin (built via `Provider`)
 * must actually route through the real provider registry + router.
 *
 * Before the T1 wiring fix, `PluginManager` aggregated provider profiles but
 * nothing registered them, so `getProviderProfile`/`resolveProviderChain`
 * never saw a plugin-contributed provider (a no-stubs-no-mocks-no-wired
 * violation). This test exercises the real seam: PluginManager.aggregated →
 * registerPluginProviderProfiles → registry → router.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Provider } from "../../src/index.js";
import { resolveProviderChain } from "../../src/internal/llm/router.js";
import { PluginManager } from "../../src/internal/plugins/manager.js";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../src/internal/providers/builtin/index.js";
import { registerPluginProviderProfiles } from "../../src/internal/providers/register-plugin-providers.js";
import {
  _resetProvidersForTests,
  getProviderProfile,
} from "../../src/internal/providers/registry.js";
import type { ProviderProfile } from "../../src/internal/providers/types.js";

const customProfile: ProviderProfile = {
  name: "custom-llm",
  apiMode: "chat_completions",
  envVars: ["CUSTOM_LLM_API_KEY"],
  authType: "none", // no key needed → router uses sentinel, deterministic
  baseUrl: "https://api.custom-llm.test/v1",
  fallbackModels: ["custom-llm/default"],
};

describe("model-provider plugin → router (integration)", () => {
  beforeEach(() => {
    _resetProvidersForTests();
    _resetBuiltinsRegistered();
    registerBuiltins();
  });

  it("registers plugin-contributed profiles so the registry resolves them", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([Provider.create(customProfile)]);

    // Pre-condition: not yet registered (only aggregated).
    expect(getProviderProfile("custom-llm")).toBeUndefined();

    const count = registerPluginProviderProfiles(mgr.aggregated.providerProfiles);

    expect(count).toBe(1);
    const resolved = getProviderProfile("custom-llm");
    expect(resolved).toBeDefined();
    expect(resolved!.baseUrl).toBe("https://api.custom-llm.test/v1");
  });

  it("lets the real router build a client chain for the custom provider", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([Provider.create(customProfile)]);
    registerPluginProviderProfiles(mgr.aggregated.providerProfiles);

    const chain = resolveProviderChain({ primary: "custom-llm" });
    expect(chain.length).toBeGreaterThanOrEqual(1);
  });

  it("does not disturb builtins", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([Provider.create(customProfile)]);
    registerPluginProviderProfiles(mgr.aggregated.providerProfiles);
    expect(getProviderProfile("anthropic")).toBeDefined();
  });

  it("empty plugin list registers nothing (count 0, no throw)", () => {
    expect(registerPluginProviderProfiles([])).toBe(0);
  });

  it("registers multiple custom providers", async () => {
    const second: ProviderProfile = {
      ...customProfile,
      name: "second-llm",
      baseUrl: "https://api.second.test/v1",
      fallbackModels: ["second-llm/default"],
    };
    const mgr = new PluginManager();
    await mgr.initialize([Provider.create(customProfile), Provider.create(second)]);
    expect(registerPluginProviderProfiles(mgr.aggregated.providerProfiles)).toBe(2);
    expect(getProviderProfile("custom-llm")).toBeDefined();
    expect(getProviderProfile("second-llm")).toBeDefined();
  });

  it("resolves a custom provider by its alias", async () => {
    const aliased: ProviderProfile = { ...customProfile, aliases: ["custom-alias"] };
    const mgr = new PluginManager();
    await mgr.initialize([Provider.create(aliased)]);
    registerPluginProviderProfiles(mgr.aggregated.providerProfiles);
    expect(getProviderProfile("custom-alias")?.name).toBe("custom-llm");
  });
});
